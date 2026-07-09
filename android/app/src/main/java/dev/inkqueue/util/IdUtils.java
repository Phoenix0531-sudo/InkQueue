package dev.inkqueue.util;

import java.util.Locale;
import java.util.Random;

public final class IdUtils {
    private static final Random RANDOM = new Random();
    private IdUtils() {}

    public static synchronized String newId(String prefix) {
        long now = System.currentTimeMillis();
        int rnd = RANDOM.nextInt(0x1000000);
        return String.format(Locale.US, "%s_%d_%06x", prefix, now, rnd);
    }
}
