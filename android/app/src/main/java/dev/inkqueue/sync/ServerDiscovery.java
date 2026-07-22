package dev.inkqueue.sync;

import android.util.Log;
import java.net.DatagramPacket;
import java.net.DatagramSocket;
import java.net.InetAddress;

public class ServerDiscovery {
    private static final String TAG = "InkQueueDisc";
    private static final int DISCOVERY_PORT = 48787;
    private static final int TIMEOUT_MS = 3000;

    private final DiscoveryCallback callback;
    private Thread thread;
    private volatile boolean running = false;
    private volatile DatagramSocket socket;

    public interface DiscoveryCallback {
        void onServerFound(String host, int port);
        void onDiscoveryFailed(String reason);
    }

    public ServerDiscovery(DiscoveryCallback callback) {
        this.callback = callback;
    }

    public void start() {
        if (running) return;
        running = true;
        thread = new Thread(new Runnable() {
            @Override
            public void run() {
                try {
                    discover();
                } catch (Exception e) {
                    Log.w(TAG, "discovery error", e);
                    if (running) callback.onDiscoveryFailed(e.toString());
                } finally {
                    closeSocket();
                    running = false;
                }
            }
        });
        thread.setDaemon(true);
        thread.start();
    }

    private void discover() throws Exception {
        DatagramSocket s = new DatagramSocket();
        socket = s;
        s.setBroadcast(true);
        s.setSoTimeout(TIMEOUT_MS);

        byte[] ping = "InkQueue:ping".getBytes("UTF-8");
        InetAddress broadcast = InetAddress.getByName("255.255.255.255");
        s.send(new DatagramPacket(ping, ping.length, broadcast, DISCOVERY_PORT));

        Log.i(TAG, "broadcast sent to 255.255.255.255:" + DISCOVERY_PORT);

        byte[] buf = new byte[256];
        long deadline = System.currentTimeMillis() + TIMEOUT_MS;
        while (running && System.currentTimeMillis() < deadline) {
            try {
                DatagramPacket packet = new DatagramPacket(buf, buf.length);
                s.receive(packet);
                String msg = new String(packet.getData(), 0, packet.getLength(), "UTF-8");
                Log.i(TAG, "received: " + msg + " from " + packet.getAddress().getHostAddress());
                if (msg.startsWith("InkQueue:pong:")) {
                    String[] parts = msg.split(":");
                    if (parts.length >= 3) {
                        String ip = parts[2];
                        int port = Integer.parseInt(parts[3]);
                        Log.i(TAG, "discovered server at " + ip + ":" + port);
                        closeSocket();
                        if (running) callback.onServerFound(ip, port);
                        return;
                    }
                }
            } catch (java.net.SocketTimeoutException e) {
                break;
            } catch (java.net.SocketException e) {
                // socket closed by stop()
                break;
            }
        }
        closeSocket();
        if (running) callback.onDiscoveryFailed("no response within " + TIMEOUT_MS + "ms");
    }

    private void closeSocket() {
        DatagramSocket s = socket;
        socket = null;
        if (s != null) {
            try { s.close(); } catch (Exception ignored) {}
        }
    }

    public void stop() {
        running = false;
        closeSocket();
        if (thread != null) {
            thread.interrupt();
            thread = null;
        }
    }

    public boolean isRunning() { return running; }
}
