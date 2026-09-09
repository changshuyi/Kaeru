package com.github.changshuyigogo.kaeru

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.net.Uri
import android.provider.Settings
import android.util.Base64
import com.getcapacitor.JSArray
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.PermissionState
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.google.mlkit.vision.common.InputImage
import com.google.mlkit.vision.documentscanner.GmsDocumentScannerOptions
import com.google.mlkit.vision.documentscanner.GmsDocumentScanning
import com.google.mlkit.vision.documentscanner.GmsDocumentScanningResult
import com.google.mlkit.vision.text.TextRecognition
import com.google.mlkit.vision.text.japanese.JapaneseTextRecognizerOptions

/*
  自建的 Capacitor plugin，只給這個 App 自己用（不是獨立套件）。
  三個方法對應 src/receiptScanner.js 的介面：
  - scanDocument：叫出系統文件掃描器（ML Kit Document Scanner，Google Play
    服務內建），回傳已經自動抓邊框、拉正、去陰影的掃描結果（一頁以上）。
  - recognizeText：把一張圖丟給 ML Kit 日文文字辨識，回傳辨識出的文字。
  - openAppSettings：開啟這個 App 在系統設定裡的頁面。

  跟 iOS 那邊不同，Android 這裡沒有自動探索機制，plugin 要在
  MainActivity.onCreate() 裡手動 registerPlugin() 才會生效。
*/
@CapacitorPlugin(
  name = "ReceiptScanner",
  permissions = [Permission(strings = [Manifest.permission.CAMERA], alias = "camera")]
)
class ReceiptScannerPlugin : Plugin() {

  private var pendingCallbackId: String? = null

  // App 一啟動就先叫醒日文辨識模型，讓 ML Kit 趁早（在使用者實際拍照
  // 之前）把模型從 Play 服務下載好，而不是等到第一次真的呼叫
  // recognizeText 時才臨時下載——側載安裝的 apk 沒有 Play 商店幫忙
  // 預先下載，這一步能省掉使用者第一次用時因為模型還沒到位而失敗。
  override fun load() {
    super.load()
    try {
      val warm = Bitmap.createBitmap(2, 2, Bitmap.Config.ARGB_8888)
      val image = InputImage.fromBitmap(warm, 0)
      TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
        .process(image)
        .addOnCompleteListener {
          // 不管辨識結果是什麼，這次呼叫本身就會觸發模型下載/初始化
        }
    } catch (e: Exception) {
      // 預熱失敗不影響其他功能，之後真的呼叫 recognizeText 還是會重試
    }
  }

  @PluginMethod
  fun scanDocument(call: PluginCall) {
    if (getPermissionState("camera") != PermissionState.GRANTED) {
      requestPermissionForAlias("camera", call, "scanPermCallback")
      return
    }
    startScan(call)
  }

  @PermissionCallback
  private fun scanPermCallback(call: PluginCall) {
    if (getPermissionState("camera") == PermissionState.GRANTED) {
      startScan(call)
    } else {
      call.reject("permission_denied")
    }
  }

  private fun startScan(call: PluginCall) {
    val activity = activity
    if (activity == null) {
      call.reject("no_activity")
      return
    }
    val options =
      GmsDocumentScannerOptions.Builder()
        .setGalleryImportAllowed(false)
        .setPageLimit(5)
        .setResultFormats(GmsDocumentScannerOptions.RESULT_FORMAT_JPEG)
        .setScannerMode(GmsDocumentScannerOptions.SCANNER_MODE_FULL)
        .build()
    val scanner = GmsDocumentScanning.getClient(options)
    bridge.saveCall(call)
    pendingCallbackId = call.callbackId
    scanner
      .getStartScanIntent(activity)
      .addOnSuccessListener { intentSender ->
        try {
          activity.startIntentSenderForResult(intentSender, SCAN_REQUEST_CODE, null, 0, 0, 0)
        } catch (e: Exception) {
          pendingCallbackId = null
          bridge.releaseCall(call)
          call.reject("scan_failed", e)
        }
      }
      .addOnFailureListener { e ->
        pendingCallbackId = null
        bridge.releaseCall(call)
        call.reject("scan_failed", e)
      }
  }

  override fun handleOnActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
    super.handleOnActivityResult(requestCode, resultCode, data)
    if (requestCode != SCAN_REQUEST_CODE) return
    val id = pendingCallbackId ?: return
    pendingCallbackId = null
    val call = bridge.getSavedCall(id) ?: return
    bridge.releaseCall(call)

    if (resultCode != Activity.RESULT_OK || data == null) {
      call.reject("cancelled")
      return
    }
    val result = GmsDocumentScanningResult.fromActivityResultIntent(data)
    val pages = result?.pages
    if (pages == null || pages.isEmpty()) {
      call.reject("no_pages")
      return
    }
    val images = JSArray()
    for (page in pages) {
      try {
        val bytes = context.contentResolver.openInputStream(page.imageUri)?.use { it.readBytes() }
        if (bytes != null) {
          images.put("data:image/jpeg;base64," + Base64.encodeToString(bytes, Base64.NO_WRAP))
        }
      } catch (e: Exception) {
        // 單頁讀取失敗就跳過，不整個失敗
      }
    }
    if (images.length() == 0) {
      call.reject("no_pages")
      return
    }
    val ret = JSObject()
    ret.put("images", images)
    call.resolve(ret)
  }

  @PluginMethod
  fun recognizeText(call: PluginCall) {
    val imageStr = call.getString("image")
    if (imageStr == null) {
      call.reject("missing_image")
      return
    }
    val bitmap = decodeImage(imageStr)
    if (bitmap == null) {
      call.reject("bad_image")
      return
    }
    val image = InputImage.fromBitmap(bitmap, 0)
    val recognizer = TextRecognition.getClient(JapaneseTextRecognizerOptions.Builder().build())
    recognizer
      .process(image)
      .addOnSuccessListener { result ->
        val allLines = result.textBlocks.flatMap { it.lines }
        // text 保留給還沒更新過、只認舊格式（純字串）的呼叫端用；lines
        // 額外把每一行的座標（左上原點，Y 軸朝下，跟 Bitmap 像素座標
        // 一致）一起帶出去，JS 端才能自己依「同一橫排」重組閱讀順序——
        // ML Kit 是照它自己切出來的文字區塊順序回傳整份文字，遇到「左邊
        // 一整欄標籤、右邊一整欄金額」這種排版，常常會把兩欄各自切成
        // 不同區塊，回傳順序變成「標籤全部先列完，金額才接著列」，跟
        // 標籤金額原本的左右對應關係整個脫節，只給文字沒辦法救回來。
        val linesArray = JSArray()
        for (line in allLines) {
          val box = line.boundingBox
          val item = JSObject()
          item.put("text", line.text)
          item.put("top", box?.top ?: 0)
          item.put("left", box?.left ?: 0)
          item.put("bottom", box?.bottom ?: 0)
          item.put("right", box?.right ?: 0)
          linesArray.put(item)
        }
        val ret = JSObject()
        ret.put("text", allLines.joinToString("\n") { it.text })
        ret.put("lines", linesArray)
        call.resolve(ret)
      }
      .addOnFailureListener { e -> call.reject("recognize_failed", e) }
  }

  @PluginMethod
  fun openAppSettings(call: PluginCall) {
    val intent = Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS)
    intent.data = Uri.fromParts("package", context.packageName, null)
    intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
    context.startActivity(intent)
    call.resolve()
  }

  private fun decodeImage(str: String): Bitmap? {
    val b64 = if (str.contains("base64,")) str.substringAfter("base64,") else str
    return try {
      val bytes = Base64.decode(b64, Base64.DEFAULT)
      BitmapFactory.decodeByteArray(bytes, 0, bytes.size)
    } catch (e: Exception) {
      null
    }
  }

  companion object {
    private const val SCAN_REQUEST_CODE = 9821
  }
}
