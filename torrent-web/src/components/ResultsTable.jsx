import { extractMagnetMultiMethod, extractMagnetFromText, extractMagnetFromTorrentFile, parseTorrentFile } from '../utils/magnetExtractor';
import { resolveMagnetViaApi } from '../utils/magnetResolver';
import { copyText } from '../utils/clipboardHelper';
import { useState } from 'react';

function formatSize(bytes) {
  if (!bytes || bytes <= 0) return "-";
  const u = ["B", "KB", "MB", "GB", "TB"];
  let i = 0, v = bytes;
  while (v >= 1024 && i < u.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(2)} ${u[i]}`;
}

export default function ResultsTable({
  rows,
  loading,
  copiedMagnet,
  onCopyMagnet,
  onResolveMagnet,
  onSendToQB,
  onSendToWebTorrent,
  webTorrentUrl,
  onWebTorrentUrlChange
}) {
  const [testText, setTestText] = useState('');
  const [testUrl, setTestUrl] = useState('');
  const [testResult, setTestResult] = useState('');
  const [isTestLoading, setIsTestLoading] = useState(false);
  const [showMagnetTester, setShowMagnetTester] = useState(false);
  const [dragOver, setDragOver] = useState(false);
  const [resolvingLink, setResolvingLink] = useState(null);
  const [copiedLink, setCopiedLink] = useState(null);

  const testExtractFromText = async () => {
    const magnet = extractMagnetFromText(testText);
    if (magnet) {
      try {
        await copyText(magnet);
        onCopyMagnet(magnet);
        setTestResult(`✅ Found and copied: ${magnet.substring(0, 100)}...`);
      } catch {
        setTestResult(`⚠️ Found magnet but copy failed: ${magnet.substring(0, 100)}...`);
      }
    } else {
      setTestResult('❌ No magnet link found in text');
    }
  };

  const testExtractFromUrl = async () => {
    if (!testUrl.trim()) return;

    setIsTestLoading(true);
    setTestResult('🔄 Testing...');

    try {
      const magnet = await extractMagnetMultiMethod(testUrl);
      if (magnet) {
        try {
          await copyText(magnet);
          onCopyMagnet(magnet);
          setTestResult(`✅ Found and copied: ${magnet.substring(0, 100)}...`);
        } catch {
          setTestResult(`⚠️ Found magnet but copy failed: ${magnet.substring(0, 100)}...`);
        }
      } else {
        setTestResult('❌ No magnet link found');
      }
    } catch (error) {
      setTestResult(`❌ Error: ${error.message}`);
    } finally {
      setIsTestLoading(false);
    }
  };

  const testWithSampleError = async () => {
    const sampleError = "Failed to launch 'magnet:?xt=urn:btih:DFC37EDB245D1B4778532903F160A2C08807BBE7&dn=Raees+%282017%29+%5BBluRay%5D+%5B720p%5D+%5BYTS+LT%5D&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969%2Fannounce' because the scheme does not have a registered handler.";
    setTestText(sampleError);
    await testExtractFromText();
  };

  const quickExtract = async () => {
    const consoleContent = prompt('Paste the console error message here:');
    if (consoleContent) {
      setTestText(consoleContent);
      const magnet = extractMagnetFromText(consoleContent);
      if (magnet) {
        try {
          await copyText(magnet);
          onCopyMagnet(magnet);
          setTestResult(`✅ Found and copied: ${magnet.substring(0, 100)}...`);
        } catch {
          setTestResult(`⚠️ Found magnet but copy failed: ${magnet.substring(0, 100)}...`);
        }
      } else {
        setTestResult('❌ No magnet link found in the text');
      }
    }
  };

  // const handleCopyErrorClick = async (e, torrentUrl) => {
  //   e.preventDefault();

  //   console.log('📋 [COPY ERROR] Starting error monitoring for:', torrentUrl);
  //   const magnet = await copyMagnetFromError(torrentUrl)
  //   // try {
  //   //   const magnet = await copyMagnetFromError(torrentUrl);
  //   //   if (magnet) {
  //   //     onCopyMagnet(magnet);
  //   //     alert('✅ Magnet link captured from error and copied to clipboard!');
  //   //   } else {
  //   //     alert('❌ No "Failed to launch" error detected. Try clicking the link manually and check console.');
  //   //   }
  //   // } catch (error) {
  //   //   console.error('Error during error capture:', error);
  //   //   alert('❌ Error during capture. Try the manual method.');
  //   // }
  // };


const handleCopyErrorClick = async (e, torrentUrl) => {
  e.preventDefault();
  try {
    // Try the new server-side magnet resolver first
    const magnet = await resolveMagnetViaApi(torrentUrl);
    await copyText(magnet);
    onCopyMagnet(magnet);
    alert('✅ Magnet link resolved and copied to clipboard!');
  } catch (resolverError) {
    console.log('Server resolver failed, trying fallback methods:', resolverError.message);

    try {
      // Fallback to existing extraction methods
      const fallbackMagnet = await extractMagnetMultiMethod(torrentUrl);
      if (fallbackMagnet) {
        await copyText(fallbackMagnet);
        onCopyMagnet(fallbackMagnet);
        alert('✅ Magnet extracted via fallback and copied!');
        return;
      }
    } catch (fallbackError) {
      console.log('Fallback extraction failed:', fallbackError.message);
    }

    // Final fallback: copy the original URL
    try {
      await copyText(torrentUrl);
      alert('⚠️ Could not resolve magnet automatically. Torrent URL copied to clipboard.\n\n💡 Try: Open the link manually and check browser console for magnet links.');
    } catch {
      alert('❌ Copy operation failed. Please copy the link manually.');
    }
  }
};

  const handleFileUpload = async (file) => {
    if (!file || !file.name.toLowerCase().endsWith('.torrent')) {
      setTestResult('❌ Please select a .torrent file');
      return;
    }

    try {
      setIsTestLoading(true);
      setTestResult('🔄 Parsing .torrent file...');

      const arrayBuffer = await file.arrayBuffer();
      const magnet = await parseTorrentFile(arrayBuffer);

      if (magnet) {
        try {
          await copyText(magnet);
          onCopyMagnet(magnet);
          setTestResult(`✅ Magnet extracted and copied: ${magnet.substring(0, 100)}...`);
        } catch {
          setTestResult(`⚠️ Magnet extracted but copy failed: ${magnet.substring(0, 100)}...`);
        }
      } else {
        setTestResult('❌ Could not extract magnet from .torrent file');
      }
    } catch (error) {
      console.error('Error parsing torrent file:', error);
      setTestResult(`❌ Error parsing file: ${error.message}`);
    } finally {
      setIsTestLoading(false);
    }
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setDragOver(false);

    const files = Array.from(e.dataTransfer.files);
    const torrentFile = files.find(file => file.name.toLowerCase().endsWith('.torrent'));

    if (torrentFile) {
      handleFileUpload(torrentFile);
    } else {
      setTestResult('❌ No .torrent file found in dropped items');
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setDragOver(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setDragOver(false);
  };


const handleDirectLinkClick = async (e, torrentUrl) => {
  e.preventDefault();
  try {
    // Try the new server-side magnet resolver first
    const magnet = await resolveMagnetViaApi(torrentUrl);
    await copyText(magnet);
    onCopyMagnet(magnet);

    // Optionally open the magnet link (one-click experience)
    if (magnet) {
      window.location.assign(magnet);
    }
  } catch (resolverError) {
    console.log('Server resolver failed, trying fallback methods:', resolverError.message);

    try {
      // Fallback to existing extraction methods
      const extracted = await extractMagnetMultiMethod(torrentUrl);
      if (extracted) {
        await copyText(extracted);
        onCopyMagnet(extracted);
        alert('✅ Magnet extracted via fallback and copied!');
        // Open the magnet link
        window.location.assign(extracted);
        return;
      }
    } catch (fallbackError) {
      console.log('Fallback extraction failed:', fallbackError.message);
    }

    // Final fallback: copy the original URL
    try {
      await copyText(torrentUrl);
      alert('⚠️ Could not resolve magnet automatically. Torrent URL copied to clipboard.');
    } catch {
      alert('❌ Copy operation failed. Please copy the link manually.');
    }
  }
};

  // const handleDirectLinkClick = async (e, torrentUrl) => {
  //   e.preventDefault();

  //   console.group('📄 [DIRECT BUTTON] Auto-extraction started');
  //   console.log('🔗 URL:', torrentUrl);
  //   console.log('🎯 Button: "📄 Direct" (handleDirectLinkClick)');
  //   console.log('📝 Description: This button tries to capture magnet links from browser protocol errors');

  //   // Start monitoring console for magnet links
  //   const originalError = console.error;
  //   let capturedMagnet = null;

  //   // Override console methods to capture magnet links
  //   const captureFunction = (...args) => {
  //     const errorMessage = args.join(' ');
  //     const magnetMatch = errorMessage.match(/magnet:\?[^'\s"<>&]+/);
  //     if (magnetMatch && !capturedMagnet) {
  //       capturedMagnet = magnetMatch[0];
  //       console.log('[AUTO-EXTRACT] 🎯 Captured magnet from console:', capturedMagnet.substring(0, 100) + '...');
  //     }
  //     originalError.apply(console, args);
  //   };

  //   console.error = captureFunction;

  //   // Also capture window errors
  //   let windowErrorCaptured = false;
  //   const windowErrorHandler = (event) => {
  //     if (!windowErrorCaptured && event.message && event.message.includes('magnet:')) {
  //       const magnetMatch = event.message.match(/magnet:\?[^'\s"<>&]+/);
  //       if (magnetMatch && !capturedMagnet) {
  //         capturedMagnet = magnetMatch[0];
  //         console.log('[AUTO-EXTRACT] 🎯 Captured magnet from window error:', capturedMagnet.substring(0, 100) + '...');
  //         windowErrorCaptured = true;
  //       }
  //     }
  //   };

  //   window.addEventListener('error', windowErrorHandler);

  //   try {
  //     // Method 1: Try using hidden iframe (better than new tab)
  //     const iframe = document.createElement('iframe');
  //     iframe.style.display = 'none';
  //     iframe.style.visibility = 'hidden';
  //     iframe.style.position = 'absolute';
  //     iframe.style.left = '-9999px';
  //     iframe.style.width = '1px';
  //     iframe.style.height = '1px';

  //     // Set iframe source to the torrent URL
  //     iframe.src = torrentUrl;
  //     document.body.appendChild(iframe);

  //     // Wait for potential errors
  //     await new Promise(resolve => setTimeout(resolve, 1000));

  //     // Clean up iframe
  //     document.body.removeChild(iframe);

  //     // If iframe didn't work, try direct navigation approach
  //     if (!capturedMagnet) {
  //       // Create a temporary link without target="_blank"
  //       const tempLink = document.createElement('a');
  //       tempLink.href = torrentUrl;
  //       tempLink.style.display = 'none';
  //       document.body.appendChild(tempLink);

  //       // Try to click it (this should generate the protocol error in current tab)
  //       try {
  //         tempLink.click();
  //       } catch (err) {
  //         // Check if the caught error contains magnet
  //         if (err.message && err.message.includes('magnet:')) {
  //           const magnetMatch = err.message.match(/magnet:\?[^'\s"<>&]+/);
  //           if (magnetMatch && !capturedMagnet) {
  //             capturedMagnet = magnetMatch[0];
  //             console.log('[AUTO-EXTRACT] 🎯 Captured magnet from click error:', capturedMagnet.substring(0, 100) + '...');
  //           }
  //         }
  //       }

  //       // Clean up temp link
  //       document.body.removeChild(tempLink);

  //       // Wait a bit more for async errors
  //       await new Promise(resolve => setTimeout(resolve, 500));
  //     }

  //   } catch (error) {
  //     console.log('[AUTO-EXTRACT] Error during extraction:', error.message);

  //     // Check if this error contains magnet
  //     if (error.message && error.message.includes('magnet:')) {
  //       const magnetMatch = error.message.match(/magnet:\?[^'\s"<>&]+/);
  //       if (magnetMatch && !capturedMagnet) {
  //         capturedMagnet = magnetMatch[0];
  //         console.log('[AUTO-EXTRACT] 🎯 Captured magnet from try-catch error:', capturedMagnet.substring(0, 100) + '...');
  //       }
  //     }
  //   } finally {
  //     // Restore console methods
  //     console.error = originalError;
  //     window.removeEventListener('error', windowErrorHandler);
  //   }

  //   // Final result
  //   if (capturedMagnet) {
  //     // Copy to clipboard
  //     navigator.clipboard.writeText(capturedMagnet)
  //       .then(() => {
  //         onCopyMagnet(capturedMagnet);
  //         alert('✅ Magnet link automatically captured and copied to clipboard!');
  //       })
  //       .catch(() => {
  //         onCopyMagnet(capturedMagnet);
  //         alert('✅ Magnet link captured! (Copy to clipboard failed - check console for manual copy)');
  //       });
  //   } else {
  //     // Show helpful message and copy torrent URL as fallback
  //     navigator.clipboard.writeText(torrentUrl).then(() => {
  //       alert('⚠️ Could not capture magnet error. Torrent URL copied to clipboard.\n\n💡 Try this manually:\n1. Open the link in a new tab\n2. Check browser console for "Failed to launch" error\n3. Copy the magnet link from the error message');
  //     }).catch(() => {
  //       alert('❌ Could not capture magnet. Try opening the link manually and check console for magnet links.');
  //     });
  //   }
  // };

  const handleTorrentFileClick = async (e, torrentUrl) => {
    e.preventDefault();

    console.group('🧲 [EXTRACT BUTTON] Magnet extraction started');
    console.log('🔗 URL:', torrentUrl);
    console.log('🎯 Button: "🧲 Extract" (handleTorrentFileClick)');
    console.log('📝 Description: This button tries to download and parse .torrent files');

    try {

      // Try direct torrent file parsing first for better reliability
      let extractedMagnet = null;

      if (torrentUrl.toLowerCase().includes('.torrent')) {
        try {
          extractedMagnet = await extractMagnetFromTorrentFile(torrentUrl);
          if (extractedMagnet) {
            console.log('✅ SUCCESS! Direct torrent parsing worked:', extractedMagnet.substring(0, 100) + '...');
            onCopyMagnet(extractedMagnet);
            console.groupEnd();
            alert('✅ Magnet link extracted from .torrent file and copied to clipboard!');
            return;
          }
        } catch (directError) {
          console.log('[FRONTEND] Direct torrent parsing failed:', directError.message);
        }
      }

      // Use the multi-method extraction as fallback
      extractedMagnet = await extractMagnetMultiMethod(torrentUrl);

      if (extractedMagnet) {
        console.log('[FRONTEND] Successfully extracted magnet via multi-method:', extractedMagnet.substring(0, 100) + '...');
        onCopyMagnet(extractedMagnet);
        alert('✅ Magnet link extracted and copied to clipboard!');
        return;
      }

      // Fallback: Try backend extraction if available
      try {
        console.log('[FRONTEND] Trying backend extraction...');
        const response = await fetch('/api/extract-magnet', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ torrentUrl }),
        });

        if (response.ok) {
          const data = await response.json();
          if (data.magnet) {
            console.log('[FRONTEND] Extracted magnet via backend:', data.magnet.substring(0, 100) + '...');
            onCopyMagnet(data.magnet);
            alert('✅ Magnet link extracted and copied to clipboard!');
            return;
          }
        }
      } catch (backendError) {
        console.log('[FRONTEND] Backend extraction failed:', backendError.message);
      }

      // Final fallback: copy the torrent URL and give instructions
      await navigator.clipboard.writeText(torrentUrl);
      alert('⚠️ Could not extract magnet automatically. Torrent URL copied to clipboard.\n\n💡 Try these options:\n1. Use "Quick Extract" if browser shows protocol errors\n2. Download .torrent file manually\n3. Check browser console for magnet links');

    } catch (error) {
      console.error('[FRONTEND] Error during magnet extraction:', error);
      // Final fallback
      try {
        await navigator.clipboard.writeText(torrentUrl);
        alert('❌ Could not extract magnet link. Torrent URL copied to clipboard.\n\nTry opening the link manually and look for magnet links in browser console errors.');
      } catch {
        alert('❌ Could not extract magnet link. Please try downloading the .torrent file directly.');
      }
    }
  };

  return (
    <div className="tableWrap">
      {/* Settings Panel */}
      <div style={{
        background: '#f8f9fa',
        padding: '10px',
        borderRadius: '5px',
        marginBottom: '10px',
        fontSize: '12px'
      }}>
        {/* WebTorrent Settings */}
        <div style={{ marginBottom: '10px' }}>
          <label style={{ display: 'block', marginBottom: '5px' }}>
            🌐 WebTorrent URL (optional):
          </label>
          <div style={{ display: 'flex', gap: '5px', alignItems: 'center' }}>
            <input
              type="url"
              value={webTorrentUrl}
              onChange={(e) => onWebTorrentUrlChange(e.target.value)}
              placeholder="https://your-webtorrent-site.com"
              style={{
                flex: 1,
                padding: '5px',
                border: '1px solid #ddd',
                borderRadius: '3px',
                fontSize: '12px'
              }}
            />
            <button
              onClick={() => onWebTorrentUrlChange('')}
              style={{
                padding: '5px 8px',
                fontSize: '11px',
                background: '#dc3545',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              Clear
            </button>
          </div>
          <small style={{ color: '#666', display: 'block', marginTop: '3px' }}>
            Set your WebTorrent website URL to send torrents directly to it
          </small>
        </div>

        {/* Magnet Extractor Section */}
        <div style={{ borderTop: '1px solid #ddd', paddingTop: '10px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '8px' }}>
            <label style={{ fontWeight: 'bold' }}>🧲 Magnet Extractor:</label>
            <button
              onClick={() => setShowMagnetTester(!showMagnetTester)}
              style={{
                padding: '3px 8px',
                fontSize: '11px',
                background: showMagnetTester ? '#6c757d' : '#007bff',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              {showMagnetTester ? 'Hide' : 'Show'} Tools
            </button>
          </div>

          {/* Quick Extract Button - Always Visible */}
          <div style={{ marginBottom: '8px' }}>
            <button
              onClick={quickExtract}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                background: '#28a745',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer',
                marginRight: '5px'
              }}
            >
              📋 Quick Extract
            </button>
            <button
              onClick={testWithSampleError}
              style={{
                padding: '6px 12px',
                fontSize: '12px',
                background: '#17a2b8',
                color: 'white',
                border: 'none',
                borderRadius: '3px',
                cursor: 'pointer'
              }}
            >
              🔬 Test Sample
            </button>
          </div>

          {/* Expanded Tools */}
          {showMagnetTester && (
            <div style={{ background: '#fff', padding: '8px', borderRadius: '3px', border: '1px solid #ddd' }}>
              {/* Text Input */}
              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', marginBottom: '3px', fontSize: '11px' }}>Extract from Text:</label>
                <textarea
                  value={testText}
                  onChange={(e) => setTestText(e.target.value)}
                  placeholder="Paste console error message or any text containing magnet link"
                  style={{
                    width: '100%',
                    height: '50px',
                    fontSize: '11px',
                    padding: '4px',
                    border: '1px solid #ccc',
                    borderRadius: '3px',
                    resize: 'vertical'
                  }}
                />
                <button
                  onClick={testExtractFromText}
                  style={{
                    marginTop: '3px',
                    padding: '4px 8px',
                    fontSize: '11px',
                    background: '#007bff',
                    color: 'white',
                    border: 'none',
                    borderRadius: '3px',
                    cursor: 'pointer'
                  }}
                >
                  Extract from Text
                </button>
              </div>

              {/* URL Input */}
              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', marginBottom: '3px', fontSize: '11px' }}>Extract from URL:</label>
                <div style={{ display: 'flex', gap: '3px' }}>
                  <input
                    type="text"
                    value={testUrl}
                    onChange={(e) => setTestUrl(e.target.value)}
                    placeholder="Enter .torrent URL to test"
                    style={{
                      flex: 1,
                      fontSize: '11px',
                      padding: '4px',
                      border: '1px solid #ccc',
                      borderRadius: '3px'
                    }}
                  />
                  <button
                    onClick={testExtractFromUrl}
                    disabled={isTestLoading}
                    style={{
                      padding: '4px 8px',
                      fontSize: '11px',
                      background: isTestLoading ? '#ccc' : '#17a2b8',
                      color: 'white',
                      border: 'none',
                      borderRadius: '3px',
                      cursor: isTestLoading ? 'not-allowed' : 'pointer'
                    }}
                  >
                    {isTestLoading ? '⏳' : 'Test'}
                  </button>
                </div>
              </div>

              {/* File Upload */}
              <div style={{ marginBottom: '8px' }}>
                <label style={{ display: 'block', marginBottom: '3px', fontSize: '11px' }}>Upload .torrent file:</label>
                <div
                  onDrop={handleDrop}
                  onDragOver={handleDragOver}
                  onDragLeave={handleDragLeave}
                  style={{
                    border: `2px dashed ${dragOver ? '#007bff' : '#ccc'}`,
                    borderRadius: '3px',
                    padding: '10px',
                    textAlign: 'center',
                    background: dragOver ? '#f0f8ff' : '#f9f9f9',
                    cursor: 'pointer',
                    fontSize: '11px',
                    position: 'relative'
                  }}
                >
                  <input
                    type="file"
                    accept=".torrent"
                    onChange={(e) => {
                      const file = e.target.files[0];
                      if (file) handleFileUpload(file);
                    }}
                    style={{
                      position: 'absolute',
                      top: 0,
                      left: 0,
                      width: '100%',
                      height: '100%',
                      opacity: 0,
                      cursor: 'pointer'
                    }}
                  />
                  <div>
                    📁 Click to select or drag & drop .torrent file
                  </div>
                  <small style={{ color: '#666' }}>
                    {dragOver ? 'Drop the file here!' : 'Instantly convert .torrent to magnet link'}
                  </small>
                </div>
              </div>

              {/* Result Display */}
              {testResult && (
                <div style={{
                  background: '#e9ecef',
                  padding: '6px',
                  borderRadius: '3px',
                  fontSize: '10px',
                  wordBreak: 'break-all',
                  maxHeight: '60px',
                  overflow: 'auto',
                  marginTop: '5px'
                }}>
                  <strong>Result:</strong><br />
                  {testResult}
                </div>
              )}
            </div>
          )}

          <small style={{ color: '#666', display: 'block', marginTop: '5px' }}>
            Use "Quick Extract" to paste console errors and extract magnet links instantly
          </small>
        </div>
      </div>
      <table className="table">
        <thead>
          <tr>
            <th>Title</th>
            <th>Seed</th>
            <th>Leech</th>
            <th>Size</th>
            <th>Tracker</th>
            <th>Date</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => {
            // Debug: Log problematic objects
            if (typeof r.title === 'object') console.error('Title is object:', r.title);
            if (typeof r.tracker === 'object') console.error('Tracker is object:', r.tracker);
            if (typeof r.published === 'object') console.error('Published is object:', r.published);

            return (
              <tr key={i}>
                <td>{typeof r.title === 'object' ? JSON.stringify(r.title) : r.title}</td>
                <td className="center">{r.seeders ?? "-"}</td>
                <td className="center">{r.leechers ?? "-"}</td>
                <td>{formatSize(r.size)}</td>
                <td>{typeof r.tracker === 'object' ? JSON.stringify(r.tracker) : (r.tracker || "-")}</td>
                <td>{typeof r.published === 'object' ? JSON.stringify(r.published) : (r.published ? new Date(r.published).toLocaleString() : "-")}</td>
                <td className="actions">
                  {r.magnet ? (
                    // Already have magnet link
                    <>
                      <button
                        onClick={() => onCopyMagnet(r.magnet)}
                        className="link"
                        title="Copy magnet link"
                        style={{
                          background: 'none',
                          border: 'none',
                          color: '#3b82f6',
                          cursor: 'pointer',
                          marginRight: '8px'
                        }}
                      >
                        {copiedMagnet === r.magnet ? '✓ Copied' : '🧲 Copy'}
                      </button>
                      <a href={r.magnet} className="link">Direct</a>
                      <button onClick={() => onSendToQB(r.magnet)} className="btnGhost">
                        Send QB
                      </button>
                      {webTorrentUrl && (
                        <button
                          onClick={() => onSendToWebTorrent(r.magnet)}
                          className="btnGhost"
                          style={{ marginLeft: '4px', background: '#e91e63', color: 'white' }}
                          title="Send to WebTorrent"
                        >
                          🌐 Web
                        </button>
                      )}
                    </>
                  ) : r.link ? (
                    <button
                      onClick={async () => {
                        setResolvingLink(r.link);
                        await onResolveMagnet(r.link);
                        setResolvingLink(null);
                        setCopiedLink(r.link);
                        setTimeout(() => setCopiedLink(null), 2000);
                      }}
                      disabled={resolvingLink === r.link}
                      className="link"
                      style={{
                        background: 'none',
                        border: 'none',
                        color: copiedLink === r.link ? '#16a34a' : resolvingLink === r.link ? '#999' : '#3b82f6',
                        cursor: resolvingLink === r.link ? 'default' : 'pointer',
                        padding: 0,
                        textDecoration: 'underline',
                        transition: 'color 0.2s',
                        fontWeight: copiedLink === r.link ? 'bold' : 'normal',
                      }}
                    >
                      {copiedLink === r.link ? '✓ Copied!' : resolvingLink === r.link ? '⏳ Resolving...' : '🧲 Get Magnet'}
                    </button>
                  ) : (
                    <span style={{ color: '#999' }}>No link</span>
                  )}
                </td>
              </tr>
            )
          })}
          {!rows.length && !loading && (
            <tr><td colSpan={7} className="empty">No results yet. Try a search.</td></tr>
          )}
        </tbody>
      </table>
    </div>
  );
}