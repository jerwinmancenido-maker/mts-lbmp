package com.mancenido.lbmp.test;

import android.content.ComponentName;
import android.content.ClipData;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.content.pm.ResolveInfo;
import android.graphics.Canvas;
import android.graphics.Color;
import android.graphics.Paint;
import android.graphics.Typeface;
import android.graphics.pdf.PdfDocument;
import android.net.Uri;

import androidx.core.content.FileProvider;

import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

import java.io.File;
import java.io.FileOutputStream;
import java.util.ArrayList;
import java.util.List;

@CapacitorPlugin(name = "NyxPrinter")
public class NyxPrinterPlugin extends Plugin {
    private static final int RECEIPT_WIDTH_80MM_PT = 227;
    private static final int RECEIPT_WIDTH_58MM_PT = 164;
    private static final int RECEIPT_80MM_PADDING_PT = 18;
    private static final int RECEIPT_58MM_PADDING_PT = 12;
    private static final float RECEIPT_80MM_TEXT_SIZE_PT = 7.2f;
    private static final float RECEIPT_58MM_TEXT_SIZE_PT = 5.8f;
    private static final int RECEIPT_80MM_LINE_HEIGHT_PT = 10;
    private static final int RECEIPT_58MM_LINE_HEIGHT_PT = 8;

    @PluginMethod
    public void printText(PluginCall call) {
        String text = call.getString("text", "");
        String documentName = call.getString("documentName", "LBMP Print");
        String paperWidth = call.getString("paperWidth", "80mm");

        if (text.trim().isEmpty()) {
            call.reject("Nothing to print.");
            return;
        }

        try {
            File printDir = new File(getContext().getCacheDir(), "lbmp-prints");
            if (!printDir.exists() && !printDir.mkdirs()) {
                call.reject("Unable to prepare printer cache.");
                return;
            }

            String safeName = documentName.replaceAll("[^A-Za-z0-9._-]", "_");
            if (safeName.length() == 0) safeName = "LBMP_Print";
            File printFile = new File(printDir, safeName + ".pdf");
            writeReceiptPdf(text, printFile, paperWidth);

            Uri printUri = FileProvider.getUriForFile(
                getContext(),
                getContext().getPackageName() + ".fileprovider",
                printFile
            );
            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setComponent(new ComponentName("net.nyx.printerservice", "net.nyx.printerservice.IntentGatewayActivity"));
            intent.setDataAndType(printUri, "application/pdf");
            intent.setClipData(ClipData.newRawUri("LBMP Print", printUri));
            intent.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION | Intent.FLAG_ACTIVITY_NEW_TASK);

            PackageManager packageManager = getContext().getPackageManager();
            ResolveInfo resolvedActivity = packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);
            if (resolvedActivity == null) {
                call.reject("NB80 printer gateway is not available. Open the device Printer app test first, or install the vendor printer service/SDK.");
                return;
            }

            getContext().grantUriPermission(
                "net.nyx.printerservice",
                printUri,
                Intent.FLAG_GRANT_READ_URI_PERMISSION
            );

            getContext().startActivity(intent);

            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("route", "net.nyx.printerservice.pdf");
            result.put("file", printUri.toString());
            result.put("paperWidth", paperWidth);
            result.put("message", "Print request opened the NB80 printer gateway. Confirm paper output; if nothing prints, vendor SDK bridge is required.");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("NB80 print failed: " + error.getMessage(), error);
        }
    }

    /**
     * Diagnostic-only status probe (added for the Device Setup printer
     * diagnostic). It never launches the gateway and never prints: it only
     * reports whether the NYX printer service package is installed and
     * whether the gateway activity resolves, so the app can persist a
     * measured printer check instead of a self-attested one.
     */
    @PluginMethod
    public void printerStatus(PluginCall call) {
        try {
            PackageManager packageManager = getContext().getPackageManager();

            boolean packageInstalled = true;
            try {
                packageManager.getPackageInfo("net.nyx.printerservice", 0);
            } catch (PackageManager.NameNotFoundException error) {
                packageInstalled = false;
            }

            Intent intent = new Intent(Intent.ACTION_VIEW);
            intent.setComponent(new ComponentName("net.nyx.printerservice", "net.nyx.printerservice.IntentGatewayActivity"));
            intent.setType("application/pdf");
            ResolveInfo resolvedActivity = packageManager.resolveActivity(intent, PackageManager.MATCH_DEFAULT_ONLY);

            JSObject result = new JSObject();
            result.put("ok", true);
            result.put("packageInstalled", packageInstalled);
            result.put("gatewayAvailable", resolvedActivity != null);
            result.put("route", "net.nyx.printerservice.pdf");
            call.resolve(result);
        } catch (Exception error) {
            call.reject("NB80 printer status check failed: " + error.getMessage(), error);
        }
    }

    private void writeReceiptPdf(String text, File outputFile, String paperWidth) throws Exception {
        boolean is58mm = "58mm".equals(paperWidth);
        int receiptWidthPt = is58mm ? RECEIPT_WIDTH_58MM_PT : RECEIPT_WIDTH_80MM_PT;
        int paddingPt = is58mm ? RECEIPT_58MM_PADDING_PT : RECEIPT_80MM_PADDING_PT;
        float textSizePt = is58mm ? RECEIPT_58MM_TEXT_SIZE_PT : RECEIPT_80MM_TEXT_SIZE_PT;
        int lineHeightPt = is58mm ? RECEIPT_58MM_LINE_HEIGHT_PT : RECEIPT_80MM_LINE_HEIGHT_PT;
        Paint textPaint = new Paint(Paint.ANTI_ALIAS_FLAG);
        textPaint.setColor(Color.BLACK);
        textPaint.setTextSize(textSizePt);
        textPaint.setTypeface(Typeface.MONOSPACE);

        List<String> wrappedLines = wrapReceiptLines(text, textPaint, receiptWidthPt, paddingPt);
        int height = Math.max(
            paddingPt * 2 + lineHeightPt * (wrappedLines.size() + 3),
            is58mm ? 180 : 240
        );

        PdfDocument pdf = new PdfDocument();
        PdfDocument.PageInfo pageInfo = new PdfDocument.PageInfo.Builder(receiptWidthPt, height, 1).create();
        PdfDocument.Page page = pdf.startPage(pageInfo);
        Canvas canvas = page.getCanvas();
        canvas.drawColor(Color.WHITE);

        int y = paddingPt + Math.round(textSizePt);
        for (String line : wrappedLines) {
            canvas.drawText(line, paddingPt, y, textPaint);
            y += lineHeightPt;
        }
        pdf.finishPage(page);

        try (FileOutputStream output = new FileOutputStream(outputFile)) {
            pdf.writeTo(output);
        } finally {
            pdf.close();
        }
    }

    private List<String> wrapReceiptLines(String text, Paint paint, int receiptWidthPt, int paddingPt) {
        int maxWidth = receiptWidthPt - paddingPt * 2;
        List<String> result = new ArrayList<>();
        String[] sourceLines = text.replace("\r", "").split("\n", -1);

        for (String sourceLine : sourceLines) {
            if (sourceLine.length() == 0) {
                result.add("");
                continue;
            }

            String remaining = sourceLine;
            while (paint.measureText(remaining) > maxWidth && remaining.length() > 1) {
                int breakAt = remaining.length();
                while (breakAt > 1 && paint.measureText(remaining.substring(0, breakAt)) > maxWidth) {
                    breakAt--;
                }

                int lastSpace = remaining.substring(0, breakAt).lastIndexOf(' ');
                if (lastSpace > 8) {
                    breakAt = lastSpace;
                }

                result.add(remaining.substring(0, breakAt).trim());
                remaining = remaining.substring(breakAt).trim();
            }
            result.add(remaining);
        }

        return result;
    }
}
