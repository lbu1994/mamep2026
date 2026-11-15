package com.mamep2026.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // app 内自研插件不在 node_modules，需显式注册（Capacitor 4+ 要求在 super.onCreate 之前）。
        // 插件名 "MamepTransport" 与 packages/platform-android 的桥契约一一对应。
        registerPlugin(MamepTransportPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
