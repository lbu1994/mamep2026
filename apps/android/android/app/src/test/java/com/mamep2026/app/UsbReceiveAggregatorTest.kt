package com.mamep2026.app

import org.junit.Assert.*
import org.junit.Test
import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

class UsbReceiveAggregatorTest {
    private class Harness {
        var now = 0L
        val tasks = linkedMapOf<Runnable, Long>()
        val chunks = mutableListOf<ByteArray>()
        val emittedAt = mutableListOf<Long>()
        val receiver = UsbReceiveAggregator(
            nowMillis = { now },
            scheduleAt = { task, deadline -> tasks[task] = deadline },
            cancel = { task -> tasks.remove(task); Unit },
            emit = { bytes -> chunks.add(bytes); emittedAt.add(now); Unit },
        )

        fun advanceTo(time: Long) {
            while (true) {
                val next = tasks.minByOrNull { it.value } ?: break
                if (next.value > time) break
                now = next.value
                tasks.remove(next.key)
                next.key.run()
            }
            now = time
        }

        fun bytes(): ByteArray = chunks.flatMap { it.asIterable() }.toByteArray()
    }

    @Test
    fun ordinaryFragmentsPreserveBytesAndWaitForIdle() {
        val harness = Harness()
        harness.receiver.accept(byteArrayOf(1, 2))
        harness.advanceTo(9)
        harness.receiver.accept(byteArrayOf(3, 4))
        harness.advanceTo(18)
        assertTrue(harness.chunks.isEmpty())
        harness.advanceTo(19)
        assertArrayEquals(byteArrayOf(1, 2, 3, 4), harness.bytes())
        assertEquals(listOf(19L), harness.emittedAt)
        assertTrue(harness.tasks.isEmpty())
    }

    @Test
    fun continuousSmallInputCannotPostponeFirstByteDeadline() {
        val harness = Harness()
        for (time in 0L..49L) {
            harness.advanceTo(time)
            harness.receiver.accept(byteArrayOf(time.toByte()))
            assertEquals(1, harness.tasks.size)
        }
        assertTrue(harness.chunks.isEmpty())
        harness.advanceTo(50)
        assertEquals(listOf(50L), harness.emittedAt)
        assertArrayEquals(ByteArray(50) { it.toByte() }, harness.bytes())
    }

    @Test
    fun capacityFlushIsImmediateAndDoesNotLeaveATimer() {
        val harness = Harness()
        val input = ByteArray(4096) { it.toByte() }
        harness.receiver.accept(input)
        assertEquals(listOf(0L), harness.emittedAt)
        assertArrayEquals(input, harness.bytes())
        assertTrue(harness.tasks.isEmpty())
    }

    @Test
    fun oversizedCallbackIsSplitWithoutLossDuplicationOrReordering() {
        val harness = Harness()
        val input = ByteArray(1024 * 1024 + 17) { (it * 31).toByte() }
        harness.receiver.accept(input)
        assertEquals(256, harness.chunks.size)
        assertTrue(harness.chunks.all { it.size == 4096 })
        assertEquals(1, harness.tasks.size)
        harness.advanceTo(10)
        assertEquals(17, harness.chunks.last().size)
        assertArrayEquals(input, harness.bytes())
    }

    @Test
    fun capacityCrossingPreservesPrefixAndCopiesMutableInput() {
        val harness = Harness()
        val prefix = ByteArray(4095) { 1 }
        val suffix = byteArrayOf(2, 3)
        harness.receiver.accept(prefix)
        prefix.fill(9)
        harness.receiver.accept(suffix)
        suffix.fill(9)
        assertEquals(4096, harness.chunks.single().size)
        harness.advanceTo(10)
        assertArrayEquals(ByteArray(4097) { if (it < 4095) 1 else (it - 4093).toByte() }, harness.bytes())
    }

    @Test
    fun sustainedInputEmitsBoundedChunksAndKeepsOneCallback() {
        val harness = Harness()
        val input = ByteArray(113) { it.toByte() }
        repeat(2000) { index ->
            harness.advanceTo(index * 9L)
            harness.receiver.accept(input)
            assertEquals(1, harness.tasks.size)
        }
        harness.advanceTo(18010)
        assertTrue(harness.chunks.all { it.size in 1..4096 })
        assertTrue(harness.emittedAt.zipWithNext().all { (first, second) -> second - first <= 54 })
        assertArrayEquals(ByteArray(226000) { input[it % input.size] }, harness.bytes())
        assertTrue(harness.tasks.isEmpty())
    }

    @Test
    fun arrivingBytesEnforceDeadlineWhenSchedulerIsDelayed() {
        val harness = Harness()
        for (time in 0L..49L) {
            harness.now = time
            harness.receiver.accept(byteArrayOf(time.toByte()))
        }
        harness.now = 50
        harness.receiver.accept(byteArrayOf(99))
        assertArrayEquals(ByteArray(50) { it.toByte() }, harness.bytes())
        harness.advanceTo(60)
        assertArrayEquals(ByteArray(51) { if (it == 50) 99 else it.toByte() }, harness.bytes())
    }

    @Test
    fun cancelledCallbackCannotFlushANewerBatchEarly() {
        val harness = Harness()
        harness.receiver.accept(byteArrayOf(1))
        val staleTask = harness.tasks.keys.single()
        harness.now = 10
        harness.receiver.accept(byteArrayOf(2))
        staleTask.run()
        assertArrayEquals(byteArrayOf(1), harness.bytes())
        assertEquals(listOf(20L), harness.tasks.values.toList())
        harness.advanceTo(20)
        assertArrayEquals(byteArrayOf(1, 2), harness.bytes())
    }

    @Test
    fun closeDiscardsPendingDataAndRejectsDequeuedAndLateCallbacks() {
        val old = Harness()
        old.receiver.accept(byteArrayOf(1))
        val dequeued = old.tasks.keys.single()
        old.receiver.close()
        old.receiver.close()
        old.now = 100
        dequeued.run()
        old.receiver.accept(ByteArray(8192))
        assertTrue(old.chunks.isEmpty())
        assertTrue(old.tasks.isEmpty())

        val reopened = Harness()
        reopened.receiver.accept(byteArrayOf(2))
        reopened.advanceTo(10)
        assertArrayEquals(byteArrayOf(2), reopened.bytes())
        assertTrue(old.chunks.isEmpty())
    }

    @Test
    fun emptyInputDoesNotScheduleOrDelayDelivery() {
        val harness = Harness()
        harness.receiver.accept(byteArrayOf())
        assertTrue(harness.tasks.isEmpty())
        harness.receiver.accept(byteArrayOf(1))
        harness.advanceTo(9)
        harness.receiver.accept(byteArrayOf())
        harness.advanceTo(10)
        assertArrayEquals(byteArrayOf(1), harness.bytes())
    }

    @Test
    fun closeWaitsForActiveEmissionAndStopsFurtherInput() {
        val emitting = CountDownLatch(1)
        val releaseEmission = CountDownLatch(1)
        val closing = CountDownLatch(1)
        var emittedCount = 0
        val receiver = UsbReceiveAggregator(
            nowMillis = { 0L },
            scheduleAt = { _, _ -> },
            cancel = { _ -> },
            emit = {
                emittedCount++
                emitting.countDown()
                check(releaseEmission.await(5, TimeUnit.SECONDS))
            },
        )
        val workers = Executors.newFixedThreadPool(2)
        try {
            val input = workers.submit { receiver.accept(ByteArray(4096)) }
            assertTrue(emitting.await(5, TimeUnit.SECONDS))
            val close = workers.submit { closing.countDown(); receiver.close() }
            assertTrue(closing.await(5, TimeUnit.SECONDS))
            assertFalse(close.isDone)
            releaseEmission.countDown()
            input.get(5, TimeUnit.SECONDS)
            close.get(5, TimeUnit.SECONDS)
            receiver.accept(ByteArray(4096))
            assertEquals(1, emittedCount)
        } finally {
            releaseEmission.countDown()
            workers.shutdownNow()
        }
    }
}
