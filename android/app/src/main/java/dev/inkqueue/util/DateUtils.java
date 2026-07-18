package dev.inkqueue.util;

import java.text.ParseException;
import java.text.SimpleDateFormat;
import java.util.Calendar;
import java.util.Date;
import java.util.Locale;
import java.util.TimeZone;

public final class DateUtils {
    private static final String DATE_PATTERN = "yyyy-MM-dd";
    private DateUtils() {}

    public static String today() {
        return formatDate(Calendar.getInstance());
    }

    public static String tomorrow(String today) {
        Calendar calendar = parseDate(today);
        calendar.add(Calendar.DAY_OF_MONTH, 1);
        return formatDate(calendar);
    }

    public static String postponeToTomorrow(String today) {
        return tomorrow(today);
    }

    public static String postponeToWeekend(String today) {
        Calendar calendar = parseDate(today);
        int dow = calendar.get(Calendar.DAY_OF_WEEK);
        int days;
        if (dow == Calendar.SATURDAY) {
            days = 7;
        } else if (dow == Calendar.SUNDAY) {
            days = 6;
        } else {
            days = Calendar.SATURDAY - dow;
        }
        calendar.add(Calendar.DAY_OF_MONTH, days);
        return formatDate(calendar);
    }

    public static String postponeToNextWeek(String today) {
        Calendar calendar = parseDate(today);
        int dow = calendar.get(Calendar.DAY_OF_WEEK);
        int days = (Calendar.MONDAY - dow + 7) % 7;
        if (days == 0) days = 7;
        calendar.add(Calendar.DAY_OF_MONTH, days);
        return formatDate(calendar);
    }

    public static boolean isTodayOrOverdue(String dueDate, String today) {
        if (isEmpty(dueDate)) return false;
        try {
            return compareDates(dueDate, today) <= 0;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    public static boolean isAfterTodayWithinThisWeek(String dueDate, String today) {
        if (isEmpty(dueDate)) return false;
        try {
            if (compareDates(dueDate, today) <= 0) return false;
            Calendar end = parseDate(today);
            int dow = end.get(Calendar.DAY_OF_WEEK);
            int daysUntilSunday = (Calendar.SUNDAY - dow + 7) % 7;
            end.add(Calendar.DAY_OF_MONTH, daysUntilSunday);
            return compareDates(dueDate, formatDate(end)) <= 0;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    public static int compareDates(String left, String right) {
        long l = startOfDayMillis(parseDate(left));
        long r = startOfDayMillis(parseDate(right));
        if (l == r) return 0;
        return l < r ? -1 : 1;
    }

    public static int daysBetween(String fromDate, String toDate) {
        long from = startOfDayMillis(parseDate(fromDate));
        long to = startOfDayMillis(parseDate(toDate));
        return (int) ((to - from) / (24L * 60L * 60L * 1000L));
    }

    public static Calendar parseDate(String date) {
        try {
            SimpleDateFormat format = new SimpleDateFormat(DATE_PATTERN, Locale.US);
            format.setLenient(false);
            Date parsed = format.parse(date);
            Calendar calendar = Calendar.getInstance();
            calendar.setTime(parsed);
            clearTime(calendar);
            return calendar;
        } catch (ParseException e) {
            throw new IllegalArgumentException("Invalid date: " + date, e);
        }
    }

    public static boolean isValidDate(String date) {
        if (isEmpty(date)) return false;
        try {
            parseDate(date);
            return true;
        } catch (IllegalArgumentException e) {
            return false;
        }
    }

    public static String formatDate(Calendar calendar) {
        SimpleDateFormat format = new SimpleDateFormat(DATE_PATTERN, Locale.US);
        return format.format(calendar.getTime());
    }

    public static String isoNow() {
        Calendar calendar = Calendar.getInstance();
        SimpleDateFormat base = new SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss", Locale.US);
        base.setTimeZone(calendar.getTimeZone());
        int offsetMs = calendar.getTimeZone().getOffset(calendar.getTimeInMillis());
        char sign = offsetMs >= 0 ? '+' : '-';
        int totalMinutes = Math.abs(offsetMs / 60000);
        int hours = totalMinutes / 60;
        int minutes = totalMinutes % 60;
        return base.format(calendar.getTime()) + String.format(Locale.US, "%c%02d:%02d", sign, hours, minutes);
    }

    public static String displayDue(TaskLike task, String today) {
        String dueDate = task.getDueDate();
        StringBuilder out = new StringBuilder();
        if (!isEmpty(dueDate)) {
            try {
                int diff = daysBetween(today, dueDate);
                if (diff == 0) out.append("today");
                else if (diff == 1) out.append("tomorrow");
                else if (diff < 0) out.append("overdue ").append(Math.abs(diff)).append("d");
                else out.append(displayMonthDay(dueDate));
            } catch (IllegalArgumentException e) {
                out.append(dueDate);
            }
        }
        return out.toString();
    }

    public static String displayMonthDay(String date) {
        Calendar calendar = parseDate(date);
        return String.format(Locale.CHINA, "%d/%d", calendar.get(Calendar.MONTH) + 1, calendar.get(Calendar.DAY_OF_MONTH));
    }

    public static String displayLastSync(String iso) {
        if (isEmpty(iso) || iso.length() < 16) return "not synced";
        return "synced " + iso.substring(11, 16);
    }

    private static long startOfDayMillis(Calendar calendar) {
        clearTime(calendar);
        return calendar.getTimeInMillis();
    }

    private static void clearTime(Calendar calendar) {
        calendar.set(Calendar.HOUR_OF_DAY, 0);
        calendar.set(Calendar.MINUTE, 0);
        calendar.set(Calendar.SECOND, 0);
        calendar.set(Calendar.MILLISECOND, 0);
    }

    public static boolean isEmpty(String s) {
        return s == null || s.length() == 0;
    }

    public interface TaskLike {
        String getDueDate();
        String getDueTime();
    }
}
