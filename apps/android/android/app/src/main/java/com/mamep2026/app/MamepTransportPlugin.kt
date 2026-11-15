package com.mamep2026.app

import android.view.WindowManager
import android.app.PendingIntent
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.hardware.usb.UsbDevice
import android.hardware.usb.UsbDeviceConnection
import android.hardware.usb.UsbManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Base64
import android.util.Log
import androidx.core.content.ContextCompat
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.hoho.android.usbserial.driver.UsbSerialDriver
import com.hoho.android.usbserial.driver.UsbSerialPort
import com.hoho.android.usbserial.driver.UsbSerialProber
import com.hoho.android.usbserial.util.SerialInputOutputManager
import java.io.ByteArrayOutputStream
import java.net.InetSocketAddress
import java.net.Socket
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

/**
 * Mamep2026 Android 原生通信插件。
 *
 * **只做字节搬运**：打开 TCP/USB 串口 / 写字节 / 来字节 / 关闭。帧编码、CRC、MBAP 分帧、超时与重试
 * 全部留在共享 JS 层（packages/communication），因此上层会话/调度/协调器与三端同源。
 *
 * 契约（与 packages/platform-android/src/bridge-contract.ts 一一对应）：
 * - 方法白名单：listSerialPorts / openSerial / openTcp / write / close；
 * - 字节以 base64 字符串传递（Capacitor JSObject 为 JSON 语义）；
 * - 事件：data（**整帧聚合**后单次投递）/ closed / error；
 * - 一次只允许一个活动传输（打开新的会先关闭旧的）；
 * - 错误码：TCP_CONNECT_FAILED / TCP_OPEN_FAILED / NOT_OPEN / WRITE_FAILED / REMOTE_CLOSED /
 * CONNECTION_RESET / USB_PERMISSION_DENIED / USB_DEVICE_NOT_FOUND / USB_DEVICE_BUSY /
 * USB_DRIVER_UNSUPPORTED / USB_PARAMETERS_UNSUPPORTED / USB_OPEN_FAILED / USB_ENUMERATE_FAILED /
 * USB_DETACHED / PLUGIN_UNAVAILABLE（由 JS 侧映射为项目错误）。
 *
 * 读回聚合：TCP 用 `available()` 立即吸收；USB 串口是流式字节，改用 **10ms 空闲窗口**聚合
 * （用户决策 Q6），既避免分片事件风暴，也远小于 300ms 请求超时预算。
 */
@CapacitorPlugin(name = "MamepTransport")
class MamepTransportPlugin : Plugin() {

    private var socket: Socket? = null
    private var reader: Thread? = null

    // ---- USB-RS485----
    private var usbPort: UsbSerialPort? = null
    private var usbConnection: UsbDeviceConnection? = null
    private var usbIoManager: SerialInputOutputManager? = null
    private var detachReceiver: BroadcastReceiver? = null
    private var permissionReceiver: BroadcastReceiver? = null

    /** USB 空闲窗口聚合（单线程 Handler，与 ioManager 回调线程间用锁保护）。 */
    private val aggregationHandler = Handler(Looper.getMainLooper())
    private val pending = ByteArrayOutputStream()
    private val pendingLock = Any()
    private val flushPending = Runnable { flushPendingData() }

    @Volatile
    private var running = false

    /** 打开 TCP 连接（一次只允许一个活动传输；重复打开会先关闭旧连接）。 */
    @PluginMethod
    fun openTcp(call: PluginCall) {
        val host = call.getString("host")
        val port = call.getInt("port")
        val connectTimeoutMs = call.getInt("connectTimeoutMs") ?: 5000

        if (host.isNullOrEmpty() || port == null) {
            call.reject("TCP_OPEN_FAILED", "host and port are required")
            return
        }

        closeActiveTransport()

        try {
            val candidate = Socket()
            candidate.tcpNoDelay = true
            candidate.connect(InetSocketAddress(host, port), connectTimeoutMs)
            socket = candidate
            running = true
            startReader(candidate)
            call.resolve()
        } catch (error: Exception) {
            closeActiveTransport()
            call.reject(
                "TCP_CONNECT_FAILED",
                "${host}:${port} connect failed: ${error.message}",
                error,
            )
        }
    }

    /**
     * 枚举 USB 串口（USB Host）。未授权也能枚举（不读取需要权限的设备字段）。
     * 返回 { ports: [{ deviceName, label, vendorId, productId, serialNumber? }] }。
     */
    @PluginMethod
    fun listSerialPorts(call: PluginCall) {
        try {
            val ports = JSArray()
            for (driver in drivers()) {
                val device = driver.device
                for (port in driver.ports) {
                    val entry = JSObject()
                    entry.put("deviceName", device.deviceName)
                    entry.put("label", labelOf(driver, port, device))
                    entry.put("vendorId", device.vendorId)
                    entry.put("productId", device.productId)
                    ports.put(entry)
                }
            }
            val payload = JSObject()
            payload.put("ports", ports)
            call.resolve(payload)
        } catch (error: Exception) {
            call.reject(
                "USB_ENUMERATE_FAILED",
                "usb serial enumeration failed: ${error.message}",
                error,
            )
        }
    }

    /**
     * 打开 USB 串口：授权（如未授权）→ openDevice → setParameters(+flowControl) → 启动读线程。
     * 链路参数由 JS 侧校验后传入，此处不重复业务规则。
     */
    @PluginMethod
    fun openSerial(call: PluginCall) {
        val deviceName = call.getString("deviceName")
        val baudRate = call.getInt("baudRate")
        val dataBits = call.getInt("dataBits")
        val stopBits = call.getInt("stopBits")
        val parity = call.getString("parity")
        val flowControl = call.getString("flowControl")

        if (deviceName.isNullOrEmpty() || baudRate == null || dataBits == null ||
            stopBits == null || parity.isNullOrEmpty()
        ) {
            call.reject(
                "USB_PARAMETERS_UNSUPPORTED",
                "deviceName / baudRate / dataBits / stopBits / parity are required",
            )
            return
        }

        closeActiveTransport()

        try {
            val manager = usbManager()
            val match = findPort(manager, deviceName)
            if (match == null) {
                call.reject("USB_DEVICE_NOT_FOUND", "no usb serial device at $deviceName")
                return
            }
            val (driver, port) = match
            val device = driver.device

            if (!manager.hasPermission(device) && !requestUsbPermission(manager, device)) {
                call.reject("USB_PERMISSION_DENIED", "usb permission denied for $deviceName")
                return
            }

            val connection = manager.openDevice(device)
            if (connection == null) {
                call.reject("USB_DEVICE_BUSY", "cannot open $deviceName (device busy?)")
                return
            }

            try {
                port.open(connection)
                port.setParameters(
                    baudRate,
                    dataBits,
                    stopBits,
                    parityConstant(parity),
                )
                // 流控：先查驱动是否真支持（不静默忽略，用户决策 Q5），
                // 不支持一律按 USB_PARAMETERS_UNSUPPORTED 如实上报。
                val requested = flowControlConstant(flowControl ?: "off")
                if (requested != UsbSerialPort.FlowControl.NONE &&
                    !port.supportedFlowControl.contains(requested)
                ) {
                    throw UnsupportedOperationException(
                        "flow control $flowControl is not supported by this driver",
                    )
                }
                port.setFlowControl(requested)
            } catch (error: Exception) {
                try {
                    port.close()
                } catch (_: Exception) {
                    // 关闭失败不掩盖原始错误。
                }
                try {
                    connection.close()
                } catch (_: Exception) {
                    // 同上。
                }
                val code = if (error is UnsupportedOperationException) {
                    "USB_PARAMETERS_UNSUPPORTED"
                } else {
                    "USB_OPEN_FAILED"
                }
                call.reject(code, "usb serial open failed: ${error.message}", error)
                return
            }

            usbPort = port
            usbConnection = connection
            startUsbReader(port)
            registerDetachReceiver(deviceName)
            call.resolve()
        } catch (error: Exception) {
            closeActiveTransport()
            call.reject("USB_OPEN_FAILED", "usb serial open failed: ${error.message}", error)
        }
    }

    /** 写字节；resolve 表示已提交给传输缓冲，不代表对端已响应。 */
    @PluginMethod
    fun write(call: PluginCall) {
        val encoded = call.getString("data")
        if (encoded.isNullOrEmpty()) {
            call.reject("WRITE_FAILED", "data (base64) is required")
            return
        }

        val usb = usbPort
        if (usb != null) {
            try {
                val bytes = Base64.decode(encoded, Base64.DEFAULT)
                // 库语义：write(byte[], timeout) 阻塞直到写完或超时，无需应用层重试。
                usb.write(bytes, USB_WRITE_TIMEOUT_MS)
                call.resolve()
            } catch (error: Exception) {
                call.reject("WRITE_FAILED", "usb serial write failed: ${error.message}", error)
            }
            return
        }

        val current = socket
        if (current == null || current.isClosed) {
            call.reject("NOT_OPEN", "transport is not open")
            return
        }
        try {
            val bytes = Base64.decode(encoded, Base64.DEFAULT)
            val stream = current.getOutputStream()
            stream.write(bytes)
            stream.flush()
            call.resolve()
        } catch (error: Exception) {
            call.reject("WRITE_FAILED", "tcp write failed: ${error.message}", error)
        }
    }

    /** 关闭当前活动传输（TCP 或 USB 串口）；幂等。 */
    @PluginMethod
    fun close(call: PluginCall) {
        if (socket == null && usbPort == null) {
            call.resolve()
            return
        }
        try {
            closeActiveTransport()
            call.resolve()
        } catch (error: Exception) {
            call.reject("NOT_OPEN", "close failed: ${error.message}", error)
        }
    }

    /**
     * 屏幕常亮（KeepAwake）：持续轮询/追踪期间保持屏幕不休眠。
     * 与活动传输无关，故在 closeActiveTransport 中**不**清除；幂等。
     */
    @PluginMethod
    fun setKeepScreenOn(call: PluginCall) {
        val enabled = call.getBoolean("enabled")
        if (enabled == null) {
            call.reject("KEEP_AWAKE_INVALID", "enabled (boolean) is required")
            return
        }
        try {
            val host = activity
            if (host == null) {
                call.resolve()
                return
            }
            host.runOnUiThread {
                if (enabled) {
                    host.window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                } else {
                    host.window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
                }
            }
            call.resolve()
        } catch (error: Exception) {
            call.reject("KEEP_AWAKE_FAILED", "setKeepScreenOn failed: ${error.message}", error)
        }
    }

    override fun handleOnDestroy() {
        closeActiveTransport()
        super.handleOnDestroy()
    }

    /** 读线程：读到数据后继续吸收当前已到达的字节（整帧聚合），再单次 notifyListeners。 */
    private fun startReader(active: Socket) {
        val thread = Thread {
            val buffer = ByteArray(4096)
            try {
                val input = active.getInputStream()
                while (running) {
                    val read = input.read(buffer)
                    if (read < 0) break
                    var size = read
                    while (input.available() > 0 && size < buffer.size) {
                        val more = input.read(buffer, size, buffer.size - size)
                        if (more <= 0) break
                        size += more
                    }
                    val payload = JSObject()
                    payload.put("data", Base64.encodeToString(buffer, 0, size, Base64.NO_WRAP))
                    payload.put("bytes", size)
                    notifyListeners("data", payload)
                }
                if (running) {
                    val closed = JSObject()
                    closed.put("code", "REMOTE_CLOSED")
                    closed.put("message", "remote peer closed the connection")
                    notifyListeners("closed", closed)
                }
            } catch (error: Exception) {
                if (running) {
                    val failure = JSObject()
                    failure.put("code", "CONNECTION_RESET")
                    failure.put("message", error.message ?: "tcp read failed")
                    notifyListeners("error", failure)
                }
            } finally {
                running = false
            }
        }
        thread.isDaemon = true
        thread.start()
        reader = thread
    }

    /** 停止读线程并关闭传输（TCP socket 与 USB 串口；幂等）。 */
    private fun closeActiveTransport() {
        // ---- USB ----
        aggregationHandler.removeCallbacks(flushPending)
        unregisterReceiver(detachReceiver)
        detachReceiver = null
        unregisterReceiver(permissionReceiver)
        permissionReceiver = null

        val io = usbIoManager
        usbIoManager = null
        if (io != null) {
            try {
                io.stop()
            } catch (error: Exception) {
                Log.w(TAG, "stopping usb io manager failed: ${error.message}")
            }
        }
        val port = usbPort
        usbPort = null
        if (port != null) {
            try {
                port.close()
            } catch (error: Exception) {
                Log.w(TAG, "closing usb port failed: ${error.message}")
            }
        }
        val connection = usbConnection
        usbConnection = null
        if (connection != null) {
            try {
                connection.close()
            } catch (error: Exception) {
                Log.w(TAG, "closing usb connection failed: ${error.message}")
            }
        }
        synchronized(pendingLock) { pending.reset() }

        // ---- TCP ----
        running = false
        reader = null
        val current = socket
        socket = null
        if (current != null) {
            try {
                current.close()
            } catch (error: Exception) {
                Log.w(TAG, "closing socket failed: ${error.message}")
            }
        }
    }

    // ---- USB 辅助 ----

    private fun usbManager(): UsbManager {
        return context.getSystemService(Context.USB_SERVICE) as UsbManager
    }

    private fun drivers(): List<UsbSerialDriver> {
        return UsbSerialProber.getDefaultProber().findAllDrivers(usbManager())
    }

    /** 按 deviceName 找到（driver, port）；未找到返回 null。 */
    private fun findPort(
        manager: UsbManager,
        deviceName: String,
    ): Pair<UsbSerialDriver, UsbSerialPort>? {
        for (driver in UsbSerialProber.getDefaultProber().findAllDrivers(manager)) {
            if (driver.device.deviceName != deviceName) continue
            val port = driver.ports.firstOrNull() ?: continue
            return driver to port
        }
        return null
    }

    /** 下拉展示用标签（不读需权限的设备字段，如 manufacturerName）。 */
    private fun labelOf(
        driver: UsbSerialDriver,
        port: UsbSerialPort,
        device: UsbDevice,
    ): String {
        val driverName = driver.javaClass.simpleName
            .removeSuffix("SerialDriver")
            .ifEmpty { "USB Serial" }
        val vid = String.format("%04x", device.vendorId)
        val pid = String.format("%04x", device.productId)
        return "$driverName ($vid:$pid, port ${port.portNumber})"
    }

    private fun parityConstant(parity: String): Int {
        return when (parity) {
            "odd" -> UsbSerialPort.PARITY_ODD
            "even" -> UsbSerialPort.PARITY_EVEN
            else -> UsbSerialPort.PARITY_NONE
        }
    }

    private fun flowControlConstant(flowControl: String): UsbSerialPort.FlowControl {
        return when (flowControl) {
            "rts-cts" -> UsbSerialPort.FlowControl.RTS_CTS
            "xon-xoff" -> UsbSerialPort.FlowControl.XON_XOFF
            else -> UsbSerialPort.FlowControl.NONE
        }
    }

    /**
     * 申请 USB 权限并等待用户响应（系统对话框）。
     * 本方法在 Capacitor 插件后台线程上阻塞等待，最长 [USB_PERMISSION_TIMEOUT_MS]。
     */
    private fun requestUsbPermission(manager: UsbManager, device: UsbDevice): Boolean {
        val latch = CountDownLatch(1)
        val result = booleanArrayOf(false)
        val receiver = object : BroadcastReceiver() {
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action != ACTION_USB_PERMISSION) return
                result[0] = intent.getBooleanExtra(UsbManager.EXTRA_PERMISSION_GRANTED, false)
                latch.countDown()
            }
        }
        permissionReceiver = receiver

        val host = activity ?: context
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.RECEIVER_NOT_EXPORTED
        } else {
            0
        }
        ContextCompat.registerReceiver(
            host,
            receiver,
            IntentFilter(ACTION_USB_PERMISSION),
            flags,
        )
        try {
            val intent = Intent(ACTION_USB_PERMISSION).setPackage(context.packageName)
            val pending = PendingIntent.getBroadcast(
                context,
                0,
                intent,
                PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
            )
            manager.requestPermission(device, pending)
            latch.await(USB_PERMISSION_TIMEOUT_MS, TimeUnit.MILLISECONDS)
        } catch (error: Exception) {
            Log.w(TAG, "usb permission request failed: ${error.message}")
        } finally {
            unregisterReceiver(receiver)
            if (permissionReceiver === receiver) permissionReceiver = null
        }
        return result[0]
    }

    private fun unregisterReceiver(receiver: BroadcastReceiver?) {
        if (receiver == null) return
        try {
            context.unregisterReceiver(receiver)
        } catch (error: Exception) {
            Log.w(TAG, "unregistering receiver failed: ${error.message}")
        }
    }

    /** 拔线监听：当前设备 detach → 先关闭传输，再发 closed(USB_DETACHED)。 */
    private fun registerDetachReceiver(deviceName: String) {
        val receiver = object : BroadcastReceiver() {
            @Suppress("DEPRECATION")
            override fun onReceive(context: Context?, intent: Intent?) {
                if (intent?.action != UsbManager.ACTION_USB_DEVICE_DETACHED) return
                val detached = intent.getParcelableExtra<UsbDevice>(UsbManager.EXTRA_DEVICE)
                if (detached == null || detached.deviceName != deviceName) return
                notifyDetached()
            }
        }
        detachReceiver = receiver
        val host = activity ?: context
        val flags = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            ContextCompat.RECEIVER_NOT_EXPORTED
        } else {
            0
        }
        ContextCompat.registerReceiver(
            host,
            receiver,
            IntentFilter(UsbManager.ACTION_USB_DEVICE_DETACHED),
            flags,
        )
    }

    private fun notifyDetached() {
        closeActiveTransport()
        val payload = JSObject()
        payload.put("code", "USB_DETACHED")
        payload.put("message", "usb serial device detached")
        notifyListeners("closed", payload)
    }

    /** USB 读线程：ioManager 回调累积字节，空闲 [USB_AGGREGATION_IDLE_MS] 后单次投递。 */
    private fun startUsbReader(port: UsbSerialPort) {
        val manager = SerialInputOutputManager(port, object : SerialInputOutputManager.Listener {
            override fun onNewData(data: ByteArray) {
                if (data.isEmpty()) return
                synchronized(pendingLock) { pending.write(data) }
                aggregationHandler.removeCallbacks(flushPending)
                aggregationHandler.postDelayed(flushPending, USB_AGGREGATION_IDLE_MS)
            }

            override fun onRunError(e: Exception) {
                if (usbPort == null) return
                val payload = JSObject()
                payload.put("code", "CONNECTION_RESET")
                payload.put("message", e.message ?: "usb serial read failed")
                notifyListeners("error", payload)
            }
        })
        usbIoManager = manager
        manager.start()
    }

    /** 把累积字节合并为一次 data 事件（无数据则不发）。 */
    private fun flushPendingData() {
        val bytes = synchronized(pendingLock) {
            if (pending.size() == 0) return
            val out = pending.toByteArray()
            pending.reset()
            out
        }
        val payload = JSObject()
        payload.put("data", Base64.encodeToString(bytes, Base64.NO_WRAP))
        payload.put("bytes", bytes.size)
        notifyListeners("data", payload)
    }

    private companion object {
        const val TAG = "MamepTransport"
        const val ACTION_USB_PERMISSION = "com.mamep2026.app.USB_PERMISSION"
        const val USB_PERMISSION_TIMEOUT_MS = 30_000L
        const val USB_WRITE_TIMEOUT_MS = 1_000
        const val USB_AGGREGATION_IDLE_MS = 10L
    }
}
