package dev.inkqueue.sync;

import android.util.Log;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;
import java.net.InetSocketAddress;
import java.nio.charset.Charset;

/**
 * LAN discovery for InkQueue reference server.
 * Protocol (server/src/server.js):
 *   client broadcast UDP "InkQueue:ping" to port 48787
 *   server replies "InkQueue:pong:<ip>:<port>"
 */
public final class ServerDiscovery {
    private static final String TAG = "InkQueueDiscover";
    public static final int DISCOVERY_PORT = 48787;
    public static final int DEFAULT_TIMEOUT_MS = 2500;

    public static final class Result {
        public final String host;
        public final int port;
        public final String baseUrl;
        public Result(String host, int port) {
            this.host = host;
            this.port = port;
            this.baseUrl = "http://" + host + ":" + port;
        }
    }

    private ServerDiscovery() {}

    /**
     * Blocking UDP discover. Call from background thread.
     * @return first pong, or null if timed out / failed
     */
    public static Result discover(int timeoutMs) {
        DatagramSocket socket = null;
        try {
            socket = new DatagramSocket();
            socket.setBroadcast(true);
            socket.setSoTimeout(timeoutMs > 0 ? timeoutMs : DEFAULT_TIMEOUT_MS);
            byte[] payload = "InkQueue:ping".getBytes(Charset.forName("UTF-8"));
            DatagramPacket packet = new DatagramPacket(
                    payload, payload.length,
                    InetAddress.getByName("255.255.255.255"), DISCOVERY_PORT);
            socket.send(packet);
            Log.i(TAG, "sent InkQueue:ping broadcast");

            byte[] buf = new byte[256];
            DatagramPacket resp = new DatagramPacket(buf, buf.length);
            socket.receive(resp);
            String text = new String(resp.getData(), 0, resp.getLength(), Charset.forName("UTF-8")).trim();
            Log.i(TAG, "recv: " + text + " from " + resp.getAddress());
            // InkQueue:pong:ip:port
            if (!text.startsWith("InkQueue:pong:")) return null;
            String rest = text.substring("InkQueue:pong:".length());
            int colon = rest.lastIndexOf(':');
            if (colon <= 0) return null;
            String host = rest.substring(0, colon).trim();
            int port;
            try {
                port = Integer.parseInt(rest.substring(colon + 1).trim());
            } catch (NumberFormatException e) {
                return null;
            }
            if (host.length() == 0 || port <= 0) return null;
            // If server echoed a placeholder, fall back to packet source IP
            if ("[IP]".equals(host) || "127.0.0.1".equals(host) || "localhost".equals(host)) {
                if (resp.getAddress() != null) {
                    host = resp.getAddress().getHostAddress();
                }
            }
            return new Result(host, port);
        } catch (Exception e) {
            Log.w(TAG, "discover failed: " + e.getMessage());
            return null;
        } finally {
            if (socket != null) {
                try { socket.close(); } catch (Exception ignore) {}
            }
        }
    }
}
