package dev.inkqueue.sync;

import org.junit.Test;
import static org.junit.Assert.*;

public class SyncResultTest {
    @Test
    public void ok_setsSuccessAndMessage() {
        SyncResult r = SyncResult.ok("已同步");
        assertTrue(r.success);
        assertEquals("已同步", r.userMessage);
        assertFalse(r.skippedBusy);
        assertEquals(0, r.opsAccepted);
    }

    @Test
    public void fail_setsTechnical() {
        SyncResult r = SyncResult.fail("同步失败，显示本地内容", "ioe");
        assertFalse(r.success);
        assertEquals("同步失败，显示本地内容", r.userMessage);
        assertEquals("ioe", r.technicalMessage);
    }

    @Test
    public void busy_marksSkipped() {
        SyncResult r = SyncResult.busy();
        assertFalse(r.success);
        assertTrue(r.skippedBusy);
        assertEquals("正在同步…", r.userMessage);
    }

    @Test
    public void accounting_fieldsDefaultZero() {
        SyncResult r = SyncResult.ok("x");
        assertEquals(0, r.opsAttempted);
        assertEquals(0, r.opsAccepted);
        assertEquals(0, r.opsIgnored);
        assertEquals(0, r.opsFailed);
        assertEquals(0, r.pendingRemaining);
        assertFalse(r.snapshotFetched);
        assertFalse(r.offline);
    }
}
