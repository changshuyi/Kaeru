package com.github.changshuyigogo.kaeru;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
  @Override
  public void onCreate(Bundle savedInstanceState) {
    // 自建的 app 內嵌 plugin（不是 npm 套件）要在這裡手動註冊，
    // 跟官方外掛（camera、preferences...）不一樣，那些是靠 npx cap sync 自動接的。
    registerPlugin(ReceiptScannerPlugin.class);
    super.onCreate(savedInstanceState);
  }
}
