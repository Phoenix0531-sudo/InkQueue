package dev.inkqueue.sync;

import org.junit.Test;
import static org.junit.Assert.*;

/**
 * Pure-logic tests for SyncScheduler's static helpers (no AlarmManager).
 * Android's BroadcastReceiver / PendingIntent paths are exercised by the
 * real device; here we only cover the interval-mapping / label logic, which
 * decides whether scheduling happens at all and which choice is saved.
 */
public class SyncSchedulerTest {

    @Test public void nearestIntervalMatchesAllowedValues() {
        assertEquals(0, SyncScheduler.nearestInterval(0));
        assertEquals(0, SyncScheduler.nearestInterval(-1));
        assertEquals(60, SyncScheduler.nearestInterval(60));
        assertEquals(300, SyncScheduler.nearestInterval(300));
        assertEquals(900, SyncScheduler.nearestInterval(900));
        assertEquals(1800, SyncScheduler.nearestInterval(1800));
    }

    @Test public void nearestIntervalSnapsOutOfBoundsDownToRange() {
        // 200 -> closer to 300 (d=100) than to 60 (d=140); 300 wins
        assertEquals(300, SyncScheduler.nearestInterval(200));
        // 450 -> closer to 300 (d=150) than to 900 (d=450); 300 wins
        assertEquals(300, SyncScheduler.nearestInterval(450));
        // 4000 -> 1800 wins
        assertEquals(1800, SyncScheduler.nearestInterval(4000));
    }

    @Test public void labelIndexFindsLabelsForAllowedIntervals() {
        for (int i = 0; i < SyncScheduler.ALLOWED_INTERVALS.length; i++) {
            int seconds = SyncScheduler.ALLOWED_INTERVALS[i];
            assertEquals(i, SyncScheduler.labelIndex(seconds));
        }
    }

    @Test public void labelIndexFallsBackToDefaultForUnknown() {
        // 9999 not in allowed -> falls back to index 2 (5 minutes)
        assertEquals(2, SyncScheduler.labelIndex(9999));
    }

    @Test public void labelsAndAllowedIntervalsAreAligned() {
        assertEquals(SyncScheduler.ALLOWED_INTERVALS.length,
            SyncScheduler.INTERVAL_LABELS.length);
        // Sanity check key positions
        assertEquals("关闭", SyncScheduler.INTERVAL_LABELS[0]);
        assertEquals("5 分钟", SyncScheduler.INTERVAL_LABELS[2]);
        assertEquals("30 分钟", SyncScheduler.INTERVAL_LABELS[SyncScheduler.INTERVAL_LABELS.length - 1]);
    }

    @Test public void defaultIntervalIs5Minutes() {
        assertEquals(300, SyncScheduler.DEFAULT_INTERVAL_SECONDS);
    }
}
