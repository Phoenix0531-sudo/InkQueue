package dev.inkqueue.data;

import org.json.JSONArray;
import org.json.JSONObject;
import java.util.ArrayList;
import java.util.List;

public class UsageProvider {
    public String provider;
    public String error;
    public int usagePercent5h;
    public int usagePercentWeek;
    public int usagePercentMonth;
    public String label5h;
    public String labelWeek;
    public String labelMonth;
    public boolean hasLiveData;
    public double totalCost;
    public String lastSession;

    public static List<UsageProvider> parseList(String body) {
        List<UsageProvider> list = new ArrayList<UsageProvider>();
        try {
            JSONObject root = new JSONObject(body);
            JSONArray providers = root.optJSONArray("providers");
            if (providers == null) return list;
            for (int i = 0; i < providers.length(); i++) {
                JSONObject p = providers.getJSONObject(i);
                UsageProvider up = new UsageProvider();
                up.provider = p.optString("provider", "unknown");
                up.error = p.optString("error", null);
                if ("null".equals(up.error) || up.error == null) up.error = null;

                JSONObject data = p.optJSONObject("data");
                if (data != null) {
                    JSONObject windows = data.optJSONObject("windows");
                    if (windows != null) {
                        up.usagePercent5h = extractPercent(windows.optJSONObject("rolling"));
                        up.usagePercentWeek = extractPercent(windows.optJSONObject("weekly"));
                        up.usagePercentMonth = extractPercent(windows.optJSONObject("monthly"));
                        up.label5h = extractLabel(windows.optJSONObject("rolling"), "5-hour");
                        up.labelWeek = extractLabel(windows.optJSONObject("weekly"), "weekly");
                        up.labelMonth = extractLabel(windows.optJSONObject("monthly"), "monthly");
                    }
                    // Fallback: check for primary/secondary (codex format)
                    JSONObject primary = data.optJSONObject("primary");
                    JSONObject secondary = data.optJSONObject("secondary");
                    if (primary != null) {
                        up.usagePercent5h = primary.optInt("usage_percent", 0);
                        up.label5h = primary.optString("label", "5-hour");
                    }
                    if (secondary != null) {
                        up.usagePercentWeek = secondary.optInt("usage_percent", 0);
                        up.labelWeek = secondary.optString("label", "weekly");
                    }
                }

                if (up.error == null) up.hasLiveData = true;

                // Extract top-level metadata
                if (data != null) {
                    up.totalCost = data.optDouble("total_cost", 0);
                    up.lastSession = data.optString("last_session", null);
                }

                list.add(up);
            }
        } catch (Exception e) {
            // return empty list
        }
        return list;
    }

    private static int extractPercent(JSONObject w) {
        if (w == null) return 0;
        return w.optInt("usage_percent", 0);
    }

    private static String extractLabel(JSONObject w, String fallback) {
        if (w == null) return fallback;
        return w.optString("label", fallback);
    }

    public String getDisplayName() {
        if ("opencode-go".equals(provider)) return "opencode-go";
        if ("chatgpt-plus".equals(provider)) return "chatgpt-plus";
        return provider;
    }

    public String getStatusText() {
        if (error != null) {
            if ("not logged in".equals(error)) return "> login required";
            if ("not configured".equals(error)) return "> not configured";
            if ("token expired".equals(error)) return "> re-auth needed";
            if ("network error".equals(error)) return "> network error";
            return "> " + error;
        }
        return null;
    }
}
