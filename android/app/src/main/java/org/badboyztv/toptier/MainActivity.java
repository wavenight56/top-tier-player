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

/** The trusted interface ships inside the APK; no website login is needed to open it. */
public class MainActivity extends Activity {
    private static final String HOST = "appassets.androidplatform.net";
    private WebView player;
    private VideoView video;
    private FrameLayout root;
    private View playback;

    @Override public void onCreate(Bundle state) {
        super.onCreate(state);
        getWindow().setFlags(WindowManager.LayoutParams.FLAG_FULLSCREEN, WindowManager.LayoutParams.FLAG_FULLSCREEN);
        root = new FrameLayout(this);
        player = new WebView(this);
        player.setBackgroundColor(Color.rgb(5,9,18));
        WebSettings settings=player.getSettings();
        settings.setJavaScriptEnabled(true);
        settings.setDomStorageEnabled(true);
        settings.setAllowFileAccess(false);
        settings.setAllowContentAccess(false);
        settings.setMediaPlaybackRequiresUserGesture(true);
        settings.setUserAgentString(settings.getUserAgentString()+" TopTierPlayer/0.4");
        player.setWebChromeClient(new WebChromeClient());
        player.addJavascriptInterface(new NativePlayback(), "TopTierNative");
        player.setWebViewClient(new WebViewClient(){
            @Override public boolean shouldOverrideUrlLoading(WebView view, WebResourceRequest req) { return !HOST.equals(req.getUrl().getHost()); }
            @Override public boolean shouldOverrideUrlLoading(WebView view, String url) { return !HOST.equals(Uri.parse(url).getHost()); }
            @Override public WebResourceResponse shouldInterceptRequest(WebView view, WebResourceRequest req) {
                Uri uri=req.getUrl();
                if (!HOST.equals(uri.getHost())) return error(403,"External pages cannot open inside the player.");
                if (!"GET".equals(req.getMethod())) return error(405,"Unsupported request.");
                try {
                    if ("/api/proxy".equals(uri.getPath())) return provider(uri.getQueryParameter("url"));
                    String path=uri.getPath();
                    if (path==null||path.equals("/")) path="/index.html";
                    if (path.contains("..")||!path.matches("/[a-zA-Z0-9._/-]+")) return error(404,"Not found");
                    String mime=path.endsWith(".js")?"application/javascript":path.endsWith(".css")?"text/css":path.endsWith(".png")?"image/png":path.endsWith(".webmanifest")?"application/manifest+json":"text/html";
                    Map<String,String> headers=new HashMap<>();
                    headers.put("Cache-Control","no-store");
                    headers.put("Content-Security-Policy","default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'; base-uri 'none'");
                    return new WebResourceResponse(mime,"UTF-8",200,"OK",headers,getAssets().open(path.substring(1)));
                } catch (Exception e) { return error(502,"Could not connect. Check the server address and internet connection, then retry."); }
            }
        });
        root.addView(player,new FrameLayout.LayoutParams(-1,-1));setContentView(root);
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
            conn.setInstanceFollowRedirects(false);conn.setConnectTimeout(15000);conn.setReadTimeout(30000);
            conn.setRequestProperty("User-Agent","TopTierPlayer/0.4");conn.setRequestProperty("Accept","application/json, text/plain, */*");
            int code=conn.getResponseCode();
            if(code>=300&&code<400){String loc=conn.getHeaderField("Location");conn.disconnect();if(loc==null)throw new IOException();url=remote(new URL(url,loc).toString());continue;}
            if(code<200||code>=300){conn.disconnect();return error(code>=400&&code<=599?code:502,"Provider rejected the request ("+code+"). Check your login and subscription.");}
            InputStream input=conn.getInputStream();
            InputStream closing=new FilterInputStream(input){@Override public void close() throws IOException {try{super.close();}finally{conn.disconnect();}}};
            Map<String,String> headers=new HashMap<>();headers.put("Cache-Control","no-store");
            return new WebResourceResponse("text/plain","UTF-8",200,"OK",headers,closing);
        }
        throw new IOException("Too many redirects");
    }
    private WebResourceResponse error(int status,String message){
        String body="{\"error\":\""+message.replace("\"","'")+"\"}";
        return new WebResourceResponse("application/json","UTF-8",status,"Request failed",Collections.singletonMap("Cache-Control","no-store"),new ByteArrayInputStream(body.getBytes(java.nio.charset.StandardCharsets.UTF_8)));
    }
    private class NativePlayback {
        @JavascriptInterface public void play(String raw,String title){
            try{remote(raw);}catch(Exception e){return;}
            runOnUiThread(()->openVideo(raw,title));
        }
    }
    private void openVideo(String url,String title){
        closeVideo();
        LinearLayout layout=new LinearLayout(this);layout.setOrientation(LinearLayout.VERTICAL);layout.setBackgroundColor(Color.BLACK);
        Button back=new Button(this);back.setText("← Back · "+title);back.setOnClickListener(v->closeVideo());layout.addView(back);
        video=new VideoView(this);layout.addView(video,new LinearLayout.LayoutParams(-1,0,1));
        MediaController controls=new MediaController(this);controls.setAnchorView(video);video.setMediaController(controls);
        playback=layout;root.addView(layout,new FrameLayout.LayoutParams(-1,-1));player.setVisibility(View.GONE);
        getWindow().addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);
        video.setOnPreparedListener(mp->{video.start();controls.show(4000);});
        video.setOnErrorListener((mp,what,extra)->{Toast.makeText(this,"This stream could not play. Try another channel or check your provider connection.",Toast.LENGTH_LONG).show();closeVideo();return true;});
        video.setVideoURI(Uri.parse(url));video.requestFocus();
    }
    private void closeVideo(){if(video!=null){video.stopPlayback();video=null;}if(playback!=null){root.removeView(playback);playback=null;}if(player!=null)player.setVisibility(View.VISIBLE);getWindow().clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);}
    @Override public void onBackPressed(){if(playback!=null){closeVideo();return;}player.evaluateJavascript("window.topTierBack ? window.topTierBack() : false", result->{if(!"true".equals(result))MainActivity.super.onBackPressed();});}
    @Override protected void onPause(){super.onPause();if(video!=null)video.pause();player.onPause();}
    @Override protected void onResume(){super.onResume();if(player!=null)player.onResume();}
    @Override protected void onDestroy(){closeVideo();if(player!=null){player.removeJavascriptInterface("TopTierNative");player.destroy();}super.onDestroy();}
}
