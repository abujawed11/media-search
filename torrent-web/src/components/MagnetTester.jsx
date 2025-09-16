import { useState } from 'react';
import { extractMagnetFromText, extractMagnetMultiMethod } from '../utils/magnetExtractor';

export default function MagnetTester() {
  const [testUrl, setTestUrl] = useState('');
  const [testText, setTestText] = useState('');
  const [result, setResult] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  const testExtractFromText = () => {
    const magnet = extractMagnetFromText(testText);
    setResult(magnet ? `Found: ${magnet}` : 'No magnet link found in text');
  };

  const testExtractFromUrl = async () => {
    if (!testUrl.trim()) return;

    setIsLoading(true);
    setResult('Testing...');

    try {
      const magnet = await extractMagnetMultiMethod(testUrl);
      setResult(magnet ? `Found: ${magnet}` : 'No magnet link found');
    } catch (error) {
      setResult(`Error: ${error.message}`);
    } finally {
      setIsLoading(false);
    }
  };

  const testWithSampleError = () => {
    const sampleError = "Failed to launch 'magnet:?xt=urn:btih:DFC37EDB245D1B4778532903F160A2C08807BBE7&dn=Raees+%282017%29+%5BBluRay%5D+%5B720p%5D+%5BYTS+LT%5D&tr=udp%3A%2F%2Ftracker.coppersurfer.tk%3A6969%2Fannounce' because the scheme does not have a registered handler.";
    setTestText(sampleError);
    const magnet = extractMagnetFromText(sampleError);
    setResult(magnet ? `Found: ${magnet}` : 'No magnet link found');
  };

  return (
    <div style={{
      position: 'fixed',
      top: '10px',
      right: '10px',
      background: 'white',
      border: '1px solid #ccc',
      padding: '10px',
      borderRadius: '5px',
      boxShadow: '0 2px 10px rgba(0,0,0,0.1)',
      width: '300px',
      fontSize: '12px',
      zIndex: 1000
    }}>
      <h4 style={{ margin: '0 0 10px 0' }}>🧲 Magnet Extractor Test</h4>

      <div style={{ marginBottom: '10px' }}>
        <button
          onClick={testWithSampleError}
          style={{
            padding: '5px 10px',
            fontSize: '11px',
            background: '#007bff',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer',
            marginRight: '5px'
          }}
        >
          Test with Sample Error
        </button>
        <button
          onClick={() => {
            const consoleContent = prompt('Paste the console error message here:');
            if (consoleContent) {
              setTestText(consoleContent);
              const magnet = extractMagnetFromText(consoleContent);
              if (magnet) {
                navigator.clipboard.writeText(magnet);
                setResult(`Found and copied: ${magnet}`);
              } else {
                setResult('No magnet link found in the text');
              }
            }
          }}
          style={{
            padding: '5px 10px',
            fontSize: '11px',
            background: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer'
          }}
        >
          Quick Extract
        </button>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'block', marginBottom: '5px' }}>Test Text:</label>
        <textarea
          value={testText}
          onChange={(e) => setTestText(e.target.value)}
          placeholder="Paste error message or text containing magnet link"
          style={{
            width: '100%',
            height: '60px',
            fontSize: '11px',
            padding: '5px',
            border: '1px solid #ccc',
            borderRadius: '3px'
          }}
        />
        <button
          onClick={testExtractFromText}
          style={{
            marginTop: '5px',
            padding: '5px 10px',
            fontSize: '11px',
            background: '#28a745',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: 'pointer'
          }}
        >
          Extract from Text
        </button>
      </div>

      <div style={{ marginBottom: '10px' }}>
        <label style={{ display: 'block', marginBottom: '5px' }}>Test URL:</label>
        <input
          type="text"
          value={testUrl}
          onChange={(e) => setTestUrl(e.target.value)}
          placeholder="Enter .torrent URL to test"
          style={{
            width: '100%',
            fontSize: '11px',
            padding: '5px',
            border: '1px solid #ccc',
            borderRadius: '3px'
          }}
        />
        <button
          onClick={testExtractFromUrl}
          disabled={isLoading}
          style={{
            marginTop: '5px',
            padding: '5px 10px',
            fontSize: '11px',
            background: isLoading ? '#ccc' : '#17a2b8',
            color: 'white',
            border: 'none',
            borderRadius: '3px',
            cursor: isLoading ? 'not-allowed' : 'pointer'
          }}
        >
          {isLoading ? 'Testing...' : 'Extract from URL'}
        </button>
      </div>

      <div style={{
        background: '#f8f9fa',
        padding: '8px',
        borderRadius: '3px',
        fontSize: '10px',
        wordBreak: 'break-all',
        maxHeight: '100px',
        overflow: 'auto'
      }}>
        <strong>Result:</strong><br />
        {result || 'No test run yet'}
      </div>
    </div>
  );
}