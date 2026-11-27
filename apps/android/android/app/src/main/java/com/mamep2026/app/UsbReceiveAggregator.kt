package com.mamep2026.app

/**
 * Collects USB bytes without interpreting frames. Emits at capacity, after 10 ms
 * of inactivity, or 50 ms after the first byte, whichever occurs first.
 * The clock and scheduler use monotonic uptime in milliseconds.
 * Emission runs under the instance lock so close waits for an active emission.
 */
internal class UsbReceiveAggregator(
    private val nowMillis: () -> Long,
    private val scheduleAt: (Runnable, Long) -> Unit,
    private val cancel: (Runnable) -> Unit,
    private val emit: (ByteArray) -> Unit,
) {
    private val buffer = ByteArray(MAX_BYTES)
    private var size = 0
    private var firstByteAt = 0L
    private var lastByteAt = 0L
    private var closed = false
    private val flushTask = Runnable { flushIfDue() }

    /** Copies input in order, emitting full chunks without retaining the input. */
    @Synchronized
    fun accept(data: ByteArray) {
        if (closed || data.isEmpty()) return
        // Enforce the deadline even when the scheduler has not run its callback.
        if (size > 0 && nowMillis() >= deadline()) flush()
        var offset = 0
        while (offset < data.size && !closed) {
            val now = nowMillis()
            if (size == 0) firstByteAt = now
            lastByteAt = now
            val count = minOf(MAX_BYTES - size, data.size - offset)
            data.copyInto(buffer, size, offset, offset + count)
            size += count
            offset += count
            if (size == MAX_BYTES) flush()
        }
        if (size > 0 && !closed) scheduleFlush()
    }

    /** Discards pending bytes and prevents queued or late callbacks from emitting. */
    @Synchronized
    fun close() {
        closed = true
        size = 0
        cancel(flushTask)
    }

    private fun deadline(): Long = minOf(firstByteAt + MAX_DELAY_MS, lastByteAt + IDLE_MS)

    private fun scheduleFlush() {
        cancel(flushTask)
        scheduleAt(flushTask, deadline())
    }

    @Synchronized
    private fun flushIfDue() {
        if (closed || size == 0) return
        // A cancelled callback may already be running; respect the current batch.
        if (nowMillis() < deadline()) scheduleFlush() else flush()
    }

    private fun flush() {
        cancel(flushTask)
        val bytes = buffer.copyOf(size)
        size = 0
        emit(bytes)
    }

    companion object {
        const val MAX_BYTES = 4096
        const val IDLE_MS = 10L
        const val MAX_DELAY_MS = 50L
    }
}
