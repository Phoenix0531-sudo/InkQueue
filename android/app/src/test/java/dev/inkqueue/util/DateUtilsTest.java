package dev.inkqueue.util;

import dev.inkqueue.data.PendingOperation;
import org.json.JSONObject;
import org.junit.Test;
import static org.junit.Assert.*;

public class DateUtilsTest {
    @Test public void mondayToWeekendReturnsSameWeekSaturday() {
        assertEquals("2026-07-11", DateUtils.postponeToWeekend("2026-07-06"));
    }

    @Test public void fridayToWeekendReturnsSameWeekSaturday() {
        assertEquals("2026-07-11", DateUtils.postponeToWeekend("2026-07-10"));
    }

    @Test public void saturdayToWeekendReturnsNextSaturday() {
        assertEquals("2026-07-18", DateUtils.postponeToWeekend("2026-07-11"));
    }

    @Test public void sundayToWeekendReturnsNextSaturday() {
        assertEquals("2026-07-18", DateUtils.postponeToWeekend("2026-07-12"));
    }

    @Test public void nextWeekReturnsNextMonday() {
        assertEquals("2026-07-13", DateUtils.postponeToNextWeek("2026-07-06"));
        assertEquals("2026-07-13", DateUtils.postponeToNextWeek("2026-07-12"));
    }

    @Test public void postponePayloadKeepsDueTimeWhenPresent() throws Exception {
        JSONObject payload = PendingOperation.postponePayload("2026-07-07", "14:00", "tomorrow");
        assertEquals("14:00", payload.getString("due_time"));
    }

    @Test public void postponePayloadDoesNotInventDueTimeWhenMissing() throws Exception {
        JSONObject payload = PendingOperation.postponePayload("2026-07-07", null, "tomorrow");
        assertFalse(payload.has("due_time"));
    }

    @Test public void displayDueKeepsMalformedDateReadable() {
        DateUtils.TaskLike task = new DateUtils.TaskLike() {
            @Override public String getDueDate() { return "2026-02-31"; }
            @Override public String getDueTime() { return "14:00"; }
        };

        assertEquals("2026-02-31", DateUtils.displayDue(task, "2026-07-06"));
    }

    @Test public void malformedDateDoesNotCountAsTodayOrThisWeek() {
        assertFalse(DateUtils.isTodayOrOverdue("2026-02-31", "2026-07-06"));
        assertFalse(DateUtils.isAfterTodayWithinThisWeek("2026-02-31", "2026-07-06"));
    }
}
