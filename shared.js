// Shared utilities for DSO Framework site
// OpenTimestamps integration and common functions

const OTS_CALENDARS = [
    'https://alice.btc.calendar.opentimestamps.org',
    'https://bob.btc.calendar.opentimestamps.org',
    'https://finney.calendar.eternitywall.com'
];

// Generate SHA-256 hash
async function generateHash(content) {
    const encoder = new TextEncoder();
    const data = encoder.encode(content);
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

// Submit to OpenTimestamps
async function submitToOpenTimestamps(hashBytes) {
    const detached = OpenTimestamps.DetachedTimestampFile.fromHash(
        new OpenTimestamps.Ops.OpSHA256(),
        hashBytes
    );
    await OpenTimestamps.stamp(detached);
    return detached.serializeToBytes();
}

// Convert array to base64
function arrayToBase64(bytes) {
    let binary = '';
    for (let i = 0; i < bytes.length; i++) {
        binary += String.fromCharCode(bytes[i]);
    }
    return btoa(binary);
}

// Convert base64 to array
function base64ToArray(base64) {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}

// Download blob helper
function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Download OTS proof
function downloadOtsProof(storageKey, itemId) {
    const items = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const item = items.find(n => n.id === itemId);
    if (!item || !item.otsProof) return;
    
    const bytes = base64ToArray(item.otsProof);
    const blob = new Blob([bytes], { type: 'application/octet-stream' });
    downloadBlob(blob, `dso-${storageKey}-${item.id}.ots`);
}

// Format timestamp for display
function formatTimestamp(iso) {
    const d = new Date(iso);
    return d.toLocaleString('en-US', {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
        second: '2-digit',
        timeZoneName: 'short'
    });
}

// Escape HTML
function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Truncate URL for display
function truncateUrl(url) {
    if (url.length > 60) {
        return url.substring(0, 57) + '...';
    }
    return url;
}

// Show status message
function showStatus(elementId, message, type = 'info') {
    const el = document.getElementById(elementId);
    if (!el) return;
    el.className = `status-message ${type}`;
    el.innerHTML = message;
    el.style.display = 'block';
}

// Hide status message
function hideStatus(elementId) {
    const el = document.getElementById(elementId);
    if (el) el.style.display = 'none';
}

// Generic save function with optional blockchain timestamp
async function saveItem(storageKey, itemData, withBlockchain, statusElementId, onComplete) {
    const timestamp = new Date().toISOString();
    const contentWithTimestamp = { ...itemData, timestamp };
    const contentString = JSON.stringify(contentWithTimestamp);
    const hash = await generateHash(contentString);
    const hashBytes = new Uint8Array(hash.match(/.{2}/g).map(byte => parseInt(byte, 16)));

    let otsProof = null;
    let otsStatus = 'none';

    if (withBlockchain) {
        showStatus(statusElementId, '<span class="spinner"></span> Submitting to OpenTimestamps calendars...', 'info');
        
        try {
            otsProof = await submitToOpenTimestamps(hashBytes);
            otsStatus = 'pending';
            showStatus(statusElementId, '✓ Submitted to Bitcoin blockchain via OpenTimestamps. Confirmation pending.', 'success');
        } catch (err) {
            console.error('OpenTimestamps error:', err);
            showStatus(statusElementId, '⚠ Blockchain timestamp failed: ' + err.message + '. Saved locally with hash only.', 'error');
        }
    } else {
        showStatus(statusElementId, '✓ Saved locally with SHA-256 hash.', 'success');
    }

    const item = {
        ...contentWithTimestamp,
        id: Date.now().toString(36) + Math.random().toString(36).substr(2),
        hash,
        otsProof: otsProof ? arrayToBase64(otsProof) : null,
        otsStatus
    };

    const items = JSON.parse(localStorage.getItem(storageKey) || '[]');
    items.unshift(item);
    localStorage.setItem(storageKey, JSON.stringify(items));

    setTimeout(() => hideStatus(statusElementId), 5000);
    
    if (onComplete) onComplete();
    
    return item;
}

// Delete item
function deleteItem(storageKey, itemId, onComplete) {
    if (!confirm('Delete this item? The blockchain timestamp (if any) remains on Bitcoin but you will lose the local proof file.')) return;
    
    const items = JSON.parse(localStorage.getItem(storageKey) || '[]').filter(n => n.id !== itemId);
    localStorage.setItem(storageKey, JSON.stringify(items));
    
    if (onComplete) onComplete();
}

// Export to JSON
function exportToJSON(storageKey, filenamePrefix) {
    const items = JSON.parse(localStorage.getItem(storageKey) || '[]');
    const blob = new Blob([JSON.stringify(items, null, 2)], { type: 'application/json' });
    downloadBlob(blob, `${filenamePrefix}-${new Date().toISOString().split('T')[0]}.json`);
}

// Import from JSON
function importFromJSON(storageKey, file, onComplete) {
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const imported = JSON.parse(e.target.result);
            if (!Array.isArray(imported)) {
                throw new Error('Invalid format');
            }
            
            const existing = JSON.parse(localStorage.getItem(storageKey) || '[]');
            const existingIds = new Set(existing.map(n => n.id));
            const newItems = imported.filter(n => !existingIds.has(n.id));
            
            const merged = [...newItems, ...existing].sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
            );
            
            localStorage.setItem(storageKey, JSON.stringify(merged));
            
            alert(`Imported ${newItems.length} new items.`);
            if (onComplete) onComplete();
        } catch (err) {
            alert('Failed to import: ' + err.message);
        }
    };
    reader.readAsText(file);
}

// Render blockchain status badge
function renderBlockchainStatus(otsStatus, otsProof, itemId, storageKey) {
    let statusHtml = '';
    if (otsStatus === 'pending') {
        statusHtml = `<span class="blockchain-status pending">₿ Pending</span>`;
    } else if (otsStatus === 'confirmed') {
        statusHtml = `<span class="blockchain-status confirmed">₿ Confirmed</span>`;
    } else {
        statusHtml = `<span class="blockchain-status none">Local only</span>`;
    }
    
    const otsDownload = otsProof 
        ? `<span class="ots-download" onclick="downloadOtsProof('${storageKey}', '${itemId}')">📥 .ots</span>`
        : '';
    
    return statusHtml + otsDownload;
}

// Generate navigation HTML
function getNavHTML(activePage) {
    const pages = [
        { id: 'notes', label: 'Notes', file: 'index.html' },
        { id: 'predictions', label: 'Predictions', file: 'predictions.html' },
        { id: 'tables', label: 'Constants', file: 'tables.html' },
        { id: 'faq', label: 'FAQ', file: 'faq.html' },
        { id: 'visuals', label: 'Visuals', file: 'visuals.html' },
        { id: 'contact', label: 'Contact', file: 'contact.html' }
    ];
    
    return `<nav>
        ${pages.map(p => `<a href="${p.file}" class="${p.id === activePage ? 'active' : ''}">${p.label}</a>`).join('')}
    </nav>`;
}

// Generate footer HTML
function getFooterHTML() {
    return `<footer>
        <div class="footer-title">ΞĐ Framework References</div>
        <div class="footer-links">
            <a href="https://doi.org/10.5281/zenodo.15058929" target="_blank">Deriving Planck's Constant</a>
            <a href="https://zenodo.org/communities/dso-framework" target="_blank">Full Framework Collection</a>
        </div>
        <div class="footer-credit">Joe W. Garrett · VaultSync Solutions Inc. · 2025</div>
    </footer>`;
}
