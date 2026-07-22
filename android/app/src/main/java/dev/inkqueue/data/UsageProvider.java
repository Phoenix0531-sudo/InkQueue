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

    // CPA / account-pool fields
    public boolean isPool;
    public boolean enough;
    public int totalAccounts;
    public int codexEnabled;
    public int xaiEnabled;
    public int success;
    public int failed;
    public int unavailable;
    public int modelCount;
    public int disabled;
    public int tokenExpired;
    public int latencyMs;
    public int recentCount;
    public int recentFails;
    public int recentAvgLatencyMs;
    public int codexDead;
    public int codexTotal;
    public int codexQuotaPercent = -1;
    public String codexQuotaLabel; // from API window, e.g. "7天" / "5小时"
    public String lastModel;
    public final List<String> lines = new ArrayList<String>();

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
                if ("null".equals(up.error) || up.error == null || up.error.length() == 0) {
                    up.error = null;
                }

                JSONObject data = p.optJSONObject("data");
                if (data != null) {
                    // Prefer CPA pool display when present.
                    boolean isCpa = "cliproxyapi".equals(up.provider)
                            || "account-pool".equals(data.optString("plan", ""))
                            || "pool".equals(data.optString("display", ""));
                    if (isCpa) {
                        up.isPool = true;
                        up.enough = data.optBoolean("enough", false);
                        up.totalAccounts = data.optInt("total_accounts", 0);
                        up.codexEnabled = data.optInt("codex_enabled", 0);
                        up.xaiEnabled = data.optInt("xai_enabled", 0);
                        up.success = data.optInt("success", 0);
                        up.failed = data.optInt("failed", 0);
                        up.unavailable = data.optInt("unavailable", 0);
                        up.modelCount = data.optInt("model_count", 0);
                        up.disabled = data.optInt("disabled", 0);
                        up.tokenExpired = data.optInt("token_expired", 0);
                        up.latencyMs = data.optInt("latency_ms", 0);
                        up.codexDead = data.optInt("codex_dead", 0);
                        up.codexTotal = data.optInt("codex_total", 0);
                        JSONObject cq = data.optJSONObject("codex_quota");
                        if (cq != null) {
                            if (up.codexDead <= 0) up.codexDead = cq.optInt("dead", 0);
                            if (up.codexTotal <= 0) up.codexTotal = cq.optInt("total", 0);
                            if (up.codexEnabled <= 0) up.codexEnabled = cq.optInt("alive", up.codexEnabled);
                            JSONObject best = cq.optJSONObject("best");
                            if (best != null) {
                                up.codexQuotaPercent = best.optInt("usage_percent", -1);
                                String label = best.optString("label", null);
                                if (label != null && label.length() > 0 && !"null".equals(label)) {
                                    up.codexQuotaLabel = label;
                                }
                            }
                        }

                        JSONObject pool = data.optJSONObject("pool");
                        if (pool != null) {
                            if (up.totalAccounts <= 0) up.totalAccounts = pool.optInt("total", 0);
                            JSONObject capacity = pool.optJSONObject("capacity");
                            if (capacity != null) {
                                if (up.codexEnabled <= 0) up.codexEnabled = capacity.optInt("codex_enabled", 0);
                                if (up.xaiEnabled <= 0) up.xaiEnabled = capacity.optInt("xai_enabled", 0);
                                if (!up.enough) up.enough = capacity.optBoolean("enough", false);
                            }
                            JSONObject byType = pool.optJSONObject("by_type");
                            if (byType != null) {
                                JSONObject codex = byType.optJSONObject("codex");
                                JSONObject xai = byType.optJSONObject("xai");
                                if (codex != null && up.codexEnabled <= 0) up.codexEnabled = codex.optInt("enabled", 0);
                                if (xai != null && up.xaiEnabled <= 0) up.xaiEnabled = xai.optInt("enabled", 0);
                                if (codex != null && up.disabled <= 0) up.disabled += codex.optInt("disabled", 0);
                                if (xai != null && up.disabled <= 0) up.disabled += xai.optInt("disabled", 0);
                                if (codex != null && up.tokenExpired <= 0) up.tokenExpired += codex.optInt("token_expired", 0);
                                if (xai != null && up.tokenExpired <= 0) up.tokenExpired += xai.optInt("token_expired", 0);
                            }
                        }
                        JSONObject health = data.optJSONObject("health");
                        if (health != null) {
                            if (up.modelCount <= 0) up.modelCount = health.optInt("model_count", 0);
                            if (up.latencyMs <= 0) up.latencyMs = health.optInt("latency_ms", 0);
                        }
                        JSONObject runtime = data.optJSONObject("runtime");
                        if (runtime != null) {
                            if (up.success <= 0) up.success = runtime.optInt("total_success", 0);
                            if (up.failed <= 0) up.failed = runtime.optInt("total_failed", 0);
                        }
                        JSONObject uq = data.optJSONObject("usage_queue");
                        if (uq != null) {
                            up.recentCount = uq.optInt("recent", uq.optInt("count", 0));
                            up.recentFails = uq.optInt("fails", 0);
                            up.recentAvgLatencyMs = uq.optInt("avg_latency_ms", 0);
                            up.lastModel = uq.optString("last_model", null);
                            if ("null".equals(up.lastModel) || (up.lastModel != null && up.lastModel.length() == 0)) {
                                up.lastModel = null;
                            }
                        }

                        JSONArray lines = data.optJSONArray("lines");
                        if (lines != null) {
                            for (int li = 0; li < lines.length(); li++) {
                                String line = lines.optString(li, null);
                                if (line != null && line.length() > 0) up.lines.add(line);
                            }
                        }
                    } else {
                        JSONObject windows = data.optJSONObject("windows");
                        if (windows != null) {
                            up.usagePercent5h = extractPercent(windows.optJSONObject("rolling"));
                            up.usagePercentWeek = extractPercent(windows.optJSONObject("weekly"));
                            up.usagePercentMonth = extractPercent(windows.optJSONObject("monthly"));
                            up.label5h = extractLabel(windows.optJSONObject("rolling"), "5-hour");
                            up.labelWeek = extractLabel(windows.optJSONObject("weekly"), "weekly");
                            up.labelMonth = extractLabel(windows.optJSONObject("monthly"), "monthly");
                        }
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
                        up.totalCost = data.optDouble("total_cost", 0);
                        up.lastSession = data.optString("last_session", null);
                    }
                }

                if (up.error == null) up.hasLiveData = true;
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
        if ("cliproxyapi".equals(provider) || isPool) return "CPA 仪表盘";
        if ("opencode-go".equals(provider)) return "OpenCode";
        if ("chatgpt-plus".equals(provider)) return "ChatGPT";
        return provider;
    }

    public String getStatusText() {
        if (error != null) {
            if ("not logged in".equals(error)) return "需要登录";
            if ("not configured".equals(error)) return "尚未配置";
            if ("token expired".equals(error)) return "需要重新授权";
            if ("network error".equals(error)) return "网络异常";
            if ("cliproxy_down".equals(error)) return "CPA 服务异常";
            return "异常：" + error;
        }
        return null;
    }
}
