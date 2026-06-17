package com.ezmusic.app

import android.os.Bundle
import android.view.View
import android.view.ViewGroup
import android.webkit.WebView
import androidx.activity.enableEdgeToEdge
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat

class MainActivity : TauriActivity() {
  override fun onCreate(savedInstanceState: Bundle?) {
    enableEdgeToEdge()
    super.onCreate(savedInstanceState)

    // Android WebView doesn't support CSS env(safe-area-inset-*) (iOS-only feature).
    // Inject the real system-bar insets as CSS custom properties so the UI can
    // add proper padding for status bar, navigation bar, and display cutouts.
    window.decorView.post {
      ViewCompat.setOnApplyWindowInsetsListener(window.decorView) { view, insets ->
        val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
        findWebView(view)?.evaluateJavascript(
          """
          (function() {
            var d = document.documentElement;
            d.style.setProperty('--safe-area-top', '${bars.top}px');
            d.style.setProperty('--safe-area-bottom', '${bars.bottom}px');
            d.style.setProperty('--safe-area-left', '${bars.left}px');
            d.style.setProperty('--safe-area-right', '${bars.right}px');
          })();
          """.trimIndent(),
          null
        )
        insets
      }
      ViewCompat.requestApplyInsets(window.decorView)
    }
  }

  private fun findWebView(parent: View): WebView? {
    if (parent is WebView) return parent
    if (parent is ViewGroup) {
      for (i in 0 until parent.childCount) {
        findWebView(parent.getChildAt(i))?.let { return it }
      }
    }
    return null
  }
}
