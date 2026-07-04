package com.mancenido.lbmp.test;

import android.os.Bundle;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(NyxPrinterPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
