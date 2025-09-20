
# Torrent Search Application

A full-stack torrent search application with true "one-click" magnet copy functionality.

## Features

- Search torrents across multiple indexers (Prowlarr/Jackett)
- True one-click magnet copy - resolves redirect URLs server-side
- Clipboard fallback for older browsers
- Extract magnet links from .torrent files
- Advanced magnet extraction tools

## One-Click Magnet Copy

This application implements a server-side magnet resolver that handles the cross-origin redirect issue when indexer URLs (like `http://93.127.199.118:9696/1/download?...`) redirect to magnet: URLs.

### How it Works

1. **Server-side Resolution**: The backend fetches URLs with `redirect: "manual"` to capture Location headers
2. **Magnet Detection**: Checks if the redirect Location header starts with `magnet:`
3. **Torrent Fallback**: If a .torrent file is returned instead, parses it to extract the magnet link
4. **Client-side Copy**: Uses modern clipboard API with fallback to legacy `execCommand`

### Acceptance Criteria

✅ **Given** a row with a download URL pointing to an indexer endpoint
✅ **When** clicking "📄 Direct" or "📋 Copy Error"
✅ **Then** the magnet is resolved server-side and copied to clipboard
✅ **And** a success toast/alert is shown

✅ **Given** an indexer returns a .torrent file instead of redirect
✅ **Then** the current behavior remains (existing torrent parsing)

✅ **No** console errors from CORS or "Failed to fetch"
✅ **No** reliance on console.error or hidden iframes

## Project Structure

```
torrent-search
├─ README.md
├─ torrent-server          # Express.js backend
│  ├─ .env                # Environment variables
│  ├─ index.js            # Main server file with magnet resolver
│  ├─ package.json
│  └─ providers/          # Prowlarr/Jackett providers
└─ torrent-web            # React frontend
   ├─ src/
   │  ├─ components/
   │  │  └─ ResultsTable.jsx    # Updated with resolver integration
   │  └─ utils/
   │     ├─ magnetResolver.js   # Server-side magnet resolution
   │     └─ clipboardHelper.js  # Clipboard with fallback
   └─ vite.config.js       # Configured with API proxy
```

## Development Setup

### Prerequisites

- Node.js 16+
- HTTPS or localhost (required for clipboard API)

### Quick Start

1. **Install dependencies:**
   ```bash
   # Install backend dependencies
   cd torrent-server
   npm install

   # Install frontend dependencies
   cd ../torrent-web
   npm install
   ```

2. **Configure backend:**
   ```bash
   # Copy and edit environment file
   cd torrent-server
   cp .env.example .env
   # Edit .env with your Prowlarr/Jackett URLs and API keys
   ```

3. **Start development servers:**
   ```bash
   # Terminal 1: Start backend (port 4000)
   cd torrent-server
   npm run dev

   # Terminal 2: Start frontend (port 5173)
   cd torrent-web
   npm run dev
   ```

4. **Access the application:**
   - Frontend: http://localhost:5173
   - Backend API: http://localhost:4000/api/health

### API Proxy Configuration

The Vite dev server is configured to proxy `/api/*` requests to the backend server at `localhost:4000`. This ensures same-origin requests during development.

## Production Deployment

- **Backend**: Deploy the torrent-server on port 4000 (or configure PORT env var)
- **Frontend**: Build with `npm run build` and serve static files
- **Same Origin**: Ensure the API resolver is hosted behind the same origin as the frontend, or configure proper CORS

## Important Notes

### HTTPS Requirement

The modern clipboard API requires HTTPS or localhost. In production:

- ✅ **HTTPS sites**: Full clipboard functionality
- ⚠️ **HTTP sites**: Falls back to legacy `document.execCommand('copy')`

### Browser Compatibility

- **Modern browsers**: Uses `navigator.clipboard.writeText()`
- **Older browsers**: Falls back to hidden textarea + `execCommand('copy')`
- **User gesture required**: Copy operations must be triggered by user interaction

## Troubleshooting

### Common Issues

1. **"Copy failed" errors**: Ensure HTTPS or localhost, and user initiated the action
2. **API not accessible**: Check that backend is running on port 4000
3. **CORS errors**: Verify proxy configuration in vite.config.js

### Manual Testing

Test against these scenarios:
- ✅ Sample URLs that 302 redirect to magnet links
- ✅ Direct .torrent file URLs
- ✅ Confirm copied text equals the magnet link
- ✅ Verify magnet links open correctly in torrent clients