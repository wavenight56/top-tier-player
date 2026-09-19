package org.badboyztv.toptier;

import android.app.Activity;
import android.os.Bundle;
import android.net.Uri;
import android.graphics.Color;
import android.view.View;
import android.view.WindowManager;
import android.webkit.*;
import android.widget.*;
import java.io.*;
import java.net.*;
import java.util.*;
import androidx.media3.common.AudioAttributes;
import androidx.media3.common.C;
import androidx.media3.common.MediaItem;
import androidx.media3.common.Player;
import androidx.media3.common.PlaybackException;
import androidx.media3.exoplayer.DefaultRenderersFactory;
import androidx.media3.exoplayer.ExoPlayer;
import androidx.media3.ui.PlayerView;

/** Native TV playback for Top Tier Player. */
public class MainActivity extends Activity {
  private static final String HOST = "appassets.androidplatform.net";
  private WebView player;
  private ExoPlayer exo;
  private FrameLayout root;
  private View playback;

  @Override public void onCreate(Bundle state) {
    super.onCreate(state);
    getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
    root = new FrameLayout(this);
    player = new WebView(this);
    player.setBackgroundColor(Color.rgb(5,9,18));
    WebSettings settings = player.getSettings();
    settings.setJavaScriptEnabled(true);
    settings.setDomStorageEnabled(true);
    settings.setAllowFileAccess(false);
    settings.setAllowContentAccess(false);
    settings.setMediaPlaybackRequiresUserGesture(true);
    settings.setUserAgentString(settings.getUserAgentString()+" TopTierPlayer/0.6");
    player.setWebChromeClient(new WebChromeClient());
    player.addJavascriptInterface(new NativePlayback(), "TopTierNative");
    player.setWebViewClient(new WebViewClient(){
      @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) { return !HOST.equals(req.getUrl().getHost()); }
      @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !HOST.equals(Uri.parse(url).getHost()); }
      @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
        Uri uri=req.getUrl();
        // The app itself stays local.  Provider-hosted artwork is allowed as a
        // subresource so channel logos can render in the guide.
        if (!HOST.equals(uri.getHost())) {
          if (req.isForMainFrame()) return error(403,"External pages cannot open inside the player.");
          return null;
        }
        if (!"GET".equals(req.getMethod())) return error(405,"Unsupported request.");
        try {
          if ("/api/proxy".equals(uri.getPath())) return provider(uri.getQueryParameter("url"));
          String path=uri.getPath();
          if (path==null||path.equals("/")) path="/index.html";
          if (path.contains("..")||!path.matches("/[a-zA-Z0-9._/-]+")) return error(404,"Not found");
          String mime=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".png")?"image/png":path.endsWith(".webmanifest")?"application/manifest+json":"text/html";
          Map<String,String> headers=new HashMap<>();
          headers.put("Cache-Control","no-store");
          headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: http: https:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");
          return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open(path.substring(1)));
        } catch (Exception e) { return error(502,"Could not connect. Check the server address and internet connection, then retry."); }
      }
    });
    root.addView(player,new FrameLayout.LayoutParams(-1,-1));
    setContentView(root);
    player.loadUrl("https://"+HOST+"/");
  }

  private URL remote(String raw) throws Exception {
    URL url=new URL(raw);
    if ((!url.getProtocol().equals("http")&&!url.getProtocol().equals("https"))||url.getUserInfo()!=null) throw new IOException("Unsupported URL");
    return url;
  }
  private WebResourceResponse provider(String raw) throws Exception {
    URL url=remote(raw);
    for(int redirect=0;redirect<6;redirect++) {
      HttpURLConnection conn=(HttpURLConnection)url.openConnection();
      conn.setInstanceFollowRedirects(false); conn.setConnectTimeout(15000); conn.setReadTimeout(30000);
      conn.setRequestProperty("User-Agent","TopTierPlayer/0.6"); conn.setRequestProperty("Accept","application/json, text/plain, */*");
      int code=conn.getResponseCode();
      if(code>=300&&code<400){String loc=conn.getHeaderField("Location");conn.disconnect();if(loc==null)throw new IOException();url=remote(new URL(url,loc).toString());continue;}
      if(code<200||code>=300){conn.disconnect();return error(code>=400&&code<=599?code:502,"Provider rejected the request ("+code+"). Check your login and subscription.");}
      InputStream input=conn.getInputStream();
      InputStream closing=new FilterInputStream(input){@Override public void close() throws IOException {try{super.close();}finally{conn.disconnect();}}};
      return new WebResourceResponse("text/plain","UTF-8",200,"OK",Collections.singletonMap("Cache-Control","no-store"),closing);
    }
    throw new IOException("Too many redirects");
  }
  private WebResourceResponse error(int status,String message) {
    String body="{\"error\":\""+message.replace("\"","'")+"\"}";
    return new WebResourceResponse("application/json","UTF-8",status,"Request failed",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(body.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
  }

  private class NativePlayback {
    @JavascriptInterface public void play(String raw,String title) {
      try { remote(raw); } catch(Exception e) { return; }
      runOnUiThread(()->openVideo(raw,title));
    }
  }
  private void openVideo(String url,String title) {
    closeVideo();
    FrameLayout layout=new FrameLayout(this);
    layout.setBackgroundColor(Color.BLACK);
    Button back=new Button(this);
    back.setText("← Back · "+title);
    back.setOnClickListener(v->closeVideo());
    layout.addView(back,new FrameLayout.LayoutParams(-1,58));
    PlayerView view=new PlayerView(this);
    view.setUseController(true);
    view.setControllerShowTimeoutMs(5000);
    FrameLayout.LayoutParams videoParams=new FrameLayout.LayoutParams(-1,-1);
    videoParams.topMargin=58;
    layout.addView(view,videoParams);
    DefaultRenderersFactory renderers=new DefaultRenderersFactory(this).setEnableDecoderFallback(true);
    exo=new ExoPlayer.Builder(this).setRenderersFactory(renderers).build();
    exo.setAudioAttributes(new AudioAttributes.Builder().setUsage(C.USAGE_MEDIA).setContentType(C.AUDIO_CONTENT_TYPE_MOVIE).build(),true);
    exo.setVolume(1f);
    view.setPlayer(exo);
    exo.addListener(new Player.Listener(){
      @Override public void onPlayerError(PlaybackException e) {
        Toast.makeText(MainActivity.this,"This stream could not play. Try another channel or check your provider connection.",Toast.LENGTH_LONG).show();
      }
    });
    playback=layout; root.addView(layout,new FrameLayout.LayoutParams(-1,-1)); player.setVisibility(View.GONE);
    getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
    exo.setMediaItem(MediaItem.fromUri(Uri.parse(url)));
    exo.prepare();
    exo.play();
    view.requestFocus();
  }
  private void closeVideo() {
    if(exo!=null){exo.release();exo=null;}
    if(playback!=null){root.removeView(playback);playback=null;}
    if(player!=null)player.setVisibility(View.VISIBLE);
    getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
  }
  @Override public void onBackPressed(){
    if(playback!=null){closeVideo();return;}
    player.evaluateJavascript("window.topTierBack ? window.topTierBack() : false", result->{if(!"true".equals(result))MainActivity.super.onBackPressed();});
  }
  @Override protected void onPause(){super.onPause();if(exo!=null)exo.pause();player.onPause();}
  @Override protected void onResume(){super.onResume();if(player!=null)player.onResume();}
  @Override protected void onDestroy(){closeVideo();if(player!=null){player.removeJavascriptInterface("TopTierNative");player.destroy();}super.onDestroy();}
}
