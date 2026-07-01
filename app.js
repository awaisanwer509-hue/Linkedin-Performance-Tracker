/* ==========================================================================
   LINKEDIN CLIENT PERFORMANCE HUB - CORE LOGIC
   ========================================================================== */

// Local SQLite Database Configuration
let db = null;
let auth = null;
let googleProvider = null;
let isCloudMode = true; // Enabled to direct data operations to Flask API
let currentUser = { email: "admin@brandslift.com", displayName: "BrandsLift Admin", uid: "local-admin" };

function initFirebase() {
    console.log("BrandsLift Hub initialized in Local Backend mode (SQLite).");
}

// Global App State
let appState = {
    clients: [],
    activeClientId: null,
    currentTheme: 'dark',
    wizardEntryMethod: 'csv', // 'csv' or 'manual'
    wizardStep: 1,
    wizardData: {
        name: '',
        headline: '',
        profileUrl: '',
        metrics: {
            followers: 0,
            followersGrowth: 0,
            impressions: 0,
            comments: 0,
            reactions: 0,
            shares: 0,
            posts: 0,
            ctr: 0.0,
            profileViews: 0
        },
        charts: {
            dates: [],
            impressions: [],
            followers: []
        },
        topPosts: []
    }
};

// Chart.js references
let impressionsChartInstance = null;
let followersChartInstance = null;

// Initialize Application
document.addEventListener('DOMContentLoaded', async () => {
    // 1. Initialize Firebase Auth/Firestore
    await initFirebase();
    updateAuthUI(currentUser !== null);

    // 2. Initialize Lucide Icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
    
    // 3. Load Theme Preference
    const savedTheme = localStorage.getItem('hub_theme') || 'dark';
    setTheme(savedTheme);

    // 4. Check if we are viewing a shared report from a URL
    const urlParams = new URLSearchParams(window.location.search);
    const sharedReportData = urlParams.get('report');
    
    if (sharedReportData) {
        loadSharedReport(sharedReportData);
    } else {
        // Normal Mode: Load clients from storage or load demo data
        await loadClients();
        switchView('agency');
    }

    // 5. Setup Drag and Drop Listeners
    setupDragAndDrop();
});

// ==========================================================================
// THEME SWITCHER
// ==========================================================================
function setTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme);
    appState.currentTheme = theme;
    localStorage.setItem('hub_theme', theme);
    
    // Toggle icon displays
    const sunIcon = document.getElementById('theme-icon-sun');
    const moonIcon = document.getElementById('theme-icon-moon');
    
    if (sunIcon && moonIcon) {
        if (theme === 'light') {
            sunIcon.style.display = 'none';
            moonIcon.style.display = 'block';
        } else {
            sunIcon.style.display = 'block';
            moonIcon.style.display = 'none';
        }
    }
    
    // Redraw charts if they exist to match new grid colors
    if (impressionsChartInstance || followersChartInstance) {
        const activeClient = appState.clients.find(c => c.id === appState.activeClientId);
        if (activeClient) renderCharts(activeClient);
    }
}

function toggleTheme() {
    setTheme(appState.currentTheme === 'dark' ? 'light' : 'dark');
}

// ==========================================================================
// ROUTING & VIEW CONTROLLER
// ==========================================================================
function switchView(viewName) {
    // Hide all view panels
    document.getElementById('view-agency-container').style.display = 'none';
    document.getElementById('view-wizard-container').style.display = 'none';
    document.getElementById('view-report-container').style.display = 'none';
    
    // Deactivate all navbar links
    document.querySelectorAll('.nav-link').forEach(link => link.classList.remove('active'));
    
    // Show active view
    if (viewName === 'agency') {
        document.getElementById('view-agency-container').style.display = 'grid';
        document.getElementById('nav-agency').classList.add('active');
        renderAgencyView();
    } else if (viewName === 'wizard') {
        document.getElementById('view-wizard-container').style.display = 'block';
        document.getElementById('nav-wizard').classList.add('active');
        resetWizard();
    } else if (viewName === 'report') {
        document.getElementById('view-report-container').style.display = 'flex';
        const reportNavLink = document.getElementById('nav-report');
        reportNavLink.style.display = 'block';
        reportNavLink.classList.add('active');
        
        // Auto-select first client if none active
        if (!appState.activeClientId && appState.clients.length > 0) {
            appState.activeClientId = appState.clients[0].id;
        }
        
        // Render active client dashboard
        const activeClient = appState.clients.find(c => c.id === appState.activeClientId);
        if (activeClient) {
            renderClientReport(activeClient);
        }
    }
}

// ==========================================================================
// DATA MANAGEMENT (FIRESTORE CLOUD & LOCAL STORAGE FALLBACK)
// ==========================================================================
async function loadClients() {
    try {
        const response = await fetch('/api/clients');
        if (!response.ok) throw new Error('API error');
        const clients = await response.json();
        
        appState.clients = clients;
        localStorage.setItem('linkedin_clients', JSON.stringify(appState.clients));
        
        // If the active client was deleted or is not accessible anymore, reset it
        if (appState.activeClientId && !appState.clients.some(c => c.id === appState.activeClientId)) {
            appState.activeClientId = null;
        }
        
        renderAgencyView();
        
        // If there's an active client, render the active dashboard
        if (appState.activeClientId) {
            const activeClient = appState.clients.find(c => c.id === appState.activeClientId);
            if (activeClient) renderClientReport(activeClient);
        }
    } catch (e) {
        console.error("Failed to load clients from SQLite, trying localStorage", e);
        // Offline Local Storage mode fallback
        const stored = localStorage.getItem('linkedin_clients');
        if (stored) {
            try {
                appState.clients = JSON.parse(stored);
            } catch (err) {
                console.error("Failed to parse stored clients", err);
                appState.clients = getDemoClients();
            }
        } else {
            appState.clients = getDemoClients();
            localStorage.setItem('linkedin_clients', JSON.stringify(appState.clients));
        }
        
        renderAgencyView();
        if (appState.activeClientId) {
            const activeClient = appState.clients.find(c => c.id === appState.activeClientId);
            if (activeClient) renderClientReport(activeClient);
        }
    }
}

async function saveClientRecord(client) {
    // Always update in-memory state
    const idx = appState.clients.findIndex(c => c.id === client.id);
    if (idx > -1) {
        appState.clients[idx] = client;
    } else {
        appState.clients.push(client);
    }
    // Always update local storage cache (frontend)
    localStorage.setItem('linkedin_clients', JSON.stringify(appState.clients));

    try {
        const response = await fetch('/api/clients', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(client)
        });
        if (!response.ok) throw new Error('API failed to save');
        console.log("Saved client to SQLite successfully: " + client.id);
    } catch (e) {
        console.error("SQLite save failed", e);
        showToast("Saved locally, but backend sync failed.", "x");
    }
}

function selectClient(clientId) {
    appState.activeClientId = clientId;
    
    // Set class highlights on client sidebar items
    document.querySelectorAll('.client-item').forEach(item => {
        item.classList.remove('active');
    });
    const selectedItem = document.getElementById(`client-item-${clientId}`);
    if (selectedItem) selectedItem.classList.add('active');
    
    switchView('report');
}

async function deleteClient(clientId, event) {
    if (event) event.stopPropagation(); // Avoid triggering selectClient
    
    const client = appState.clients.find(c => c.id === clientId);
    if (!client) return;
    
    if (confirm(`Are you sure you want to delete "${client.name}"? All performance audits will be deleted.`)) {
        try {
            const response = await fetch(`/api/clients/${clientId}`, {
                method: 'DELETE'
            });
            if (!response.ok) throw new Error('API delete failed');
            showToast("Client deleted from database", "trash");
        } catch (e) {
            console.error("SQLite delete failed", e);
            showToast("Deleted locally, backend failed.", "x");
        }
        
        // Immediately update local cache and memory list
        appState.clients = appState.clients.filter(c => c.id !== clientId);
        localStorage.setItem('linkedin_clients', JSON.stringify(appState.clients));
        
        renderAgencyView();
        
        if (appState.activeClientId === clientId) {
            appState.activeClientId = null;
            document.getElementById('nav-report').style.display = 'none';
            switchView('agency');
        }
    }
}

async function importLocalClientsToCloud() {
    const stored = localStorage.getItem('linkedin_clients');
    if (!stored) return;
    
    try {
        const localClients = JSON.parse(stored);
        if (localClients.length === 0) return;
        
        if (confirm(`Do you want to upload your ${localClients.length} local client profile(s) to the cloud?`)) {
            for (const client of localClients) {
                client.ownerEmail = currentUser.email;
                client.ownerUid = currentUser.uid;
                client.collaborators = [];
                if (client.id.startsWith('demo_')) {
                    client.id = 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5);
                }
                await db.collection("clients").doc(client.id).set(client);
            }
            
            localStorage.removeItem('linkedin_clients');
            updateAuthUI(true);
            showToast("Local profiles synced to cloud successfully!", "check-circle");
            await loadClients();
        }
    } catch (e) {
        console.error("Local sync failed", e);
        showToast("Sync failed.", "x");
    }
}

// ==========================================================================
// RENDER VIEWS
// ==========================================================================
function renderAgencyView() {
    const listContainer = document.getElementById('client-list-container');
    const gridContainer = document.getElementById('agency-clients-grid');
    
    listContainer.innerHTML = '';
    gridContainer.innerHTML = '';
    
    if (appState.clients.length === 0) {
        listContainer.innerHTML = `
            <div class="client-item" style="cursor: default;">
                <div class="client-info">
                    <h4>No Active Clients</h4>
                    <p>Click "Setup Client" to get started.</p>
                </div>
            </div>
        `;
        gridContainer.innerHTML = `
            <div class="card" style="grid-column: 1/-1; text-align: center; padding: 40px;">
                <p style="color: var(--text-secondary); margin-bottom: 20px;">No performance sheets created yet. Set up a client using CSV reports or manual inputs.</p>
                <button class="btn btn-primary" onclick="switchView('wizard')">
                    <i data-lucide="plus"></i> Add First Client
                </button>
            </div>
        `;
        if (typeof lucide !== 'undefined') lucide.createIcons();
        return;
    }
    
    // Populate Sidebar & Cards
    appState.clients.forEach(client => {
        const health = calculateHealthScore(client);
        const healthColor = getHealthColor(health);
        
        let isOwner = true;
        let ownershipTag = '';
        if (isCloudMode && currentUser) {
            if (client.ownerEmail === currentUser.email) {
                ownershipTag = `<span class="client-tag owned"><i data-lucide="user"></i> Owned by me</span>`;
            } else {
                isOwner = false;
                ownershipTag = `<span class="client-tag shared"><i data-lucide="users"></i> Shared</span>`;
            }
        }
        
        // Sidebar list
        const isActive = client.id === appState.activeClientId;
        const item = document.createElement('div');
        item.className = `client-item ${isActive ? 'active' : ''}`;
        item.id = `client-item-${client.id}`;
        item.onclick = () => selectClient(client.id);
        
        const deleteBtnHtml = isOwner ? `
            <button class="btn-icon" style="background: transparent; border: none; padding: 4px; color: var(--text-muted);" onclick="deleteClient('${client.id}', event)">
                <i data-lucide="trash" style="width: 14px; height: 14px;"></i>
            </button>
        ` : '';
        
        item.innerHTML = `
            <div class="client-info">
                <h4>${client.name}</h4>
                <p>${client.metrics.followers.toLocaleString()} followers</p>
                <div class="client-badge-container">${ownershipTag}</div>
            </div>
            ${deleteBtnHtml}
        `;
        listContainer.appendChild(item);
        
        // Agency Card Grid item
        const card = document.createElement('div');
        card.className = 'card card-interactive';
        card.onclick = () => selectClient(client.id);
        
        card.innerHTML = `
            <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 16px;">
                <div class="profile-avatar" style="width: 48px; height: 48px; font-size: 16px;">
                    ${client.name.split(' ').map(n => n[0]).join('').substring(0, 2)}
                </div>
                <div style="overflow: hidden;">
                    <h4 style="font-size: 1rem; white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${client.name}</h4>
                    <p style="font-size: 0.75rem; color: var(--text-secondary); white-space: nowrap; overflow: hidden; text-overflow: ellipsis;">${client.headline || 'LinkedIn Creator'}</p>
                    <div style="margin-top: 4px;">${ownershipTag}</div>
                </div>
            </div>
            
            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 16px; font-size: 0.8rem;">
                <div>
                    <span style="color: var(--text-muted); display: block;">Impressions</span>
                    <strong style="font-size: 1rem; color: var(--text-primary);">${client.metrics.impressions.toLocaleString()}</strong>
                </div>
                <div>
                    <span style="color: var(--text-muted); display: block;">Followers</span>
                    <strong style="font-size: 1rem; color: var(--text-primary);">${client.metrics.followers.toLocaleString()}</strong>
                </div>
                <div>
                    <span style="color: var(--text-muted); display: block;">Engagement</span>
                    <strong style="font-size: 1.0rem; color: var(--text-primary);">${calculateEngagementRate(client)}%</strong>
                </div>
                <div>
                    <span style="color: var(--text-muted); display: block;">Health Score</span>
                    <strong style="font-size: 1rem; color: ${healthColor};">${health}%</strong>
                </div>
            </div>
            
            <div style="display: flex; gap: 8px; justify-content: flex-end; border-top: 1px solid var(--border-color); padding-top: 12px;">
                ${isOwner ? `
                <button class="btn btn-secondary" style="padding: 6px 12px; font-size: 0.75rem;" onclick="deleteClient('${client.id}', event)">
                    <i data-lucide="trash" style="width: 12px; height: 12px;"></i> Delete
                </button>
                ` : ''}
                <button class="btn btn-primary" style="padding: 6px 12px; font-size: 0.75rem;">
                    <i data-lucide="eye" style="width: 12px; height: 12px;"></i> View Audit
                </button>
            </div>
        `;
        gridContainer.appendChild(card);
    });
    
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function renderClientReport(client) {
    // 1. Details
    document.getElementById('report-client-name').textContent = client.name;
    document.getElementById('report-client-headline-tag').textContent = client.headline || 'LinkedIn Creator';
    document.getElementById('report-avatar').textContent = client.name.split(' ').map(n => n[0]).join('').substring(0, 2);
    
    const profileLink = document.getElementById('report-client-url');
    if (client.profileUrl) {
        profileLink.href = client.profileUrl;
        profileLink.style.display = 'inline-flex';
    } else {
        profileLink.style.display = 'none';
    }
    
    document.getElementById('report-date-range').textContent = client.dateRange || 'Report Summary';

    // 2. Scorecard values
    document.getElementById('scorecard-followers').textContent = client.metrics.followers.toLocaleString();
    
    const growthVal = client.metrics.followersGrowth;
    const growthText = document.getElementById('scorecard-followers-growth');
    if (growthVal > 0) {
        growthText.textContent = `+${growthVal.toLocaleString()} new`;
        document.getElementById('trend-followers').style.display = 'flex';
    } else {
        growthText.textContent = 'Stable';
        document.getElementById('trend-followers').style.display = 'flex';
    }
    
    document.getElementById('scorecard-impressions').textContent = client.metrics.impressions.toLocaleString();
    const impressionsAvg = client.metrics.posts > 0 ? Math.round(client.metrics.impressions / client.metrics.posts) : 0;
    document.getElementById('scorecard-impressions-avg').textContent = `Avg: ${impressionsAvg.toLocaleString()} / post`;

    document.getElementById('scorecard-comments').textContent = client.metrics.comments.toLocaleString();
    const commentsAvg = client.metrics.posts > 0 ? (client.metrics.comments / client.metrics.posts).toFixed(1) : '0';
    document.getElementById('scorecard-comments-avg').textContent = `Avg: ${commentsAvg} / post`;

    document.getElementById('scorecard-posts').textContent = client.metrics.posts.toLocaleString();
    // Frequency calculation
    let freqText = '0 posts';
    if (client.metrics.posts > 0) {
        const weeks = 4; // assume 30 days is ~4 weeks
        const pW = (client.metrics.posts / weeks).toFixed(1);
        freqText = `${pW} posts / week`;
    }
    document.getElementById('scorecard-posts-freq').textContent = freqText;

    // Health score radial progress
    const score = calculateHealthScore(client);
    document.getElementById('scorecard-health').textContent = `${score}%`;
    
    const label = document.getElementById('scorecard-health-label');
    if (score >= 85) {
        label.textContent = "Excellent standing";
        label.style.color = "var(--success)";
    } else if (score >= 60) {
        label.textContent = "Healthy growth";
        label.style.color = "var(--warning)";
    } else {
        label.textContent = "Action Required";
        label.style.color = "var(--danger)";
    }

    // Set radial dash offset
    // Radius of circle is 30, circumference is 2 * PI * r = 188.4
    const circle = document.getElementById('scorecard-health-radial');
    if (circle) {
        const circumference = 2 * Math.PI * 30; // ~188.49
        circle.style.strokeDasharray = circumference;
        const offset = circumference - (score / 100) * circumference;
        circle.style.strokeDashoffset = offset;
        circle.style.stroke = getHealthColor(score);
    }

    // 2b. Optional Card values: CTR and Profile Views
    const ctrCard = document.getElementById('card-ctr');
    const ctrVal = client.metrics.ctr;
    if (ctrVal !== undefined && ctrVal > 0) {
        document.getElementById('scorecard-ctr').textContent = `${parseFloat(ctrVal).toFixed(2)}%`;
        const clicks = Math.round(client.metrics.impressions * (ctrVal / 100));
        document.getElementById('scorecard-clicks-total').textContent = `${clicks.toLocaleString()} clicks`;
        ctrCard.style.display = 'flex';
    } else {
        ctrCard.style.display = 'none';
    }

    const pvCard = document.getElementById('card-profile-views');
    const pvVal = client.metrics.profileViews;
    if (pvVal !== undefined && pvVal > 0) {
        document.getElementById('scorecard-profile-views').textContent = pvVal.toLocaleString();
        pvCard.style.display = 'flex';
    } else {
        pvCard.style.display = 'none';
    }

    // 3. Render Top posts list
    const tbody = document.getElementById('top-posts-tbody');
    tbody.innerHTML = '';
    
    if (!client.topPosts || client.topPosts.length === 0) {
        tbody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: var(--text-muted);">No post analytics available for this client.</td></tr>`;
    } else {
        // Sort top posts by impressions desc
        const sortedPosts = [...client.topPosts].sort((a,b) => b.impressions - a.impressions).slice(0, 5);
        sortedPosts.forEach(post => {
            const row = document.createElement('tr');
            const snippet = post.text.length > 55 ? post.text.substring(0, 55) + '...' : post.text;
            const engagementSum = (post.reactions || 0) + (post.comments || 0) + (post.shares || 0);
            
            row.innerHTML = `
                <td>
                    <div class="post-cell-content">
                        <i data-lucide="file-text" style="width: 16px; height: 16px; color: var(--text-muted); flex-shrink: 0;"></i>
                        <span title="${post.text.replace(/"/g, '&quot;')}">${snippet}</span>
                    </div>
                </td>
                <td><span class="post-type-badge ${post.type || 'text'}">${post.type || 'text'}</span></td>
                <td><strong>${post.impressions.toLocaleString()}</strong></td>
                <td>
                    <span style="font-weight:600;">${engagementSum.toLocaleString()}</span>
                    <span style="font-size:0.75rem; color:var(--text-secondary); block;">(${post.comments || 0} comments)</span>
                </td>
            `;
            tbody.appendChild(row);
        });
    }

    // 4. Generate Insights
    generateInsightsList(client);

    // 5. Render Charts
    renderCharts(client);

    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
}

function generateInsightsList(client) {
    const list = document.getElementById('insights-list');
    list.innerHTML = '';
    
    const engRate = parseFloat(calculateEngagementRate(client));
    const weeklyPosts = client.metrics.posts / 4;
    const score = calculateHealthScore(client);
    
    const insights = [];

    // Posting Frequency Insight
    if (weeklyPosts >= 3) {
        insights.push({
            type: 'check',
            title: 'High Content Frequency',
            desc: `Posting ${weeklyPosts.toFixed(1)} times/week is exceptional! You maintain strong visibility inside your client's network.`
        });
    } else if (weeklyPosts >= 1.5) {
        insights.push({
            type: 'info',
            title: 'Steady Content Cadence',
            desc: `You publish ~${weeklyPosts.toFixed(1)} posts/week. Consistent posting tells LinkedIn's algorithm the profile is active.`
        });
    } else {
        insights.push({
            type: 'alert',
            title: 'Increase Posting Frequency',
            desc: `Current frequency is under 1.5 posts per week. Aim for at least 2-3 quality posts weekly to significantly boost impressions.`
        });
    }

    // Engagement Insight
    if (engRate >= 4.0) {
        insights.push({
            type: 'check',
            title: 'Stellar Engagement Rate',
            desc: `Your engagement rate is ${engRate}%, which is far above the typical LinkedIn average (1.5% - 2%). The content resonates deeply!`
        });
    } else if (engRate >= 1.8) {
        insights.push({
            type: 'info',
            title: 'Healthy Interaction Levels',
            desc: `Engagement stands at ${engRate}%. Readers are commenting and liking. Great foundation to expand conversation threads.`
        });
    } else {
        insights.push({
            type: 'danger',
            title: 'Low Engagement (Under 1.5%)',
            desc: `Engagement is ${engRate}%. Try ending posts with direct, hook-like questions and actively reply to comments in the first 60 minutes.`
        });
    }

    // Comments Ratio
    const commentRatio = client.metrics.posts > 0 ? (client.metrics.comments / client.metrics.posts) : 0;
    if (commentRatio >= 15) {
        insights.push({
            type: 'check',
            title: 'Thriving Community Conversations',
            desc: `Averages ${Math.round(commentRatio)} comments per post. These discussions expand the reach of the posts exponentially.`
        });
    } else if (commentRatio < 5 && client.metrics.posts > 0) {
        insights.push({
            type: 'alert',
            title: 'Encourage Reader Dialogue',
            desc: `Averaging only ${commentRatio.toFixed(1)} comments per post. Shift posts from "sharing information" to "starting debates or Q&As".`
        });
    }

    // Render insight items
    insights.forEach(ins => {
        const item = document.createElement('div');
        item.className = 'insight-item';
        
        let iconName = 'info';
        if (ins.type === 'check') iconName = 'check-circle2';
        else if (ins.type === 'alert') iconName = 'alert-triangle';
        else if (ins.type === 'danger') iconName = 'x-circle';
        
        item.innerHTML = `
            <div class="insight-icon ${ins.type}">
                <i data-lucide="${iconName}"></i>
            </div>
            <div class="insight-body">
                <h5>${ins.title}</h5>
                <p>${ins.desc}</p>
            </div>
        `;
        list.appendChild(item);
    });
}

function renderCharts(client) {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    const textColor = isDark ? '#9ca3af' : '#475569';
    const gridColor = isDark ? 'rgba(255, 255, 255, 0.05)' : 'rgba(0, 0, 0, 0.05)';
    
    // Destroy existing instances if any
    if (impressionsChartInstance) impressionsChartInstance.destroy();
    if (followersChartInstance) followersChartInstance.destroy();
    
    // Get Canvas Elements
    const ctxImp = document.getElementById('chart-impressions').getContext('2d');
    const ctxFol = document.getElementById('chart-followers').getContext('2d');
    
    const dates = client.charts.dates.length > 0 ? client.charts.dates : ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    const impressionsData = client.charts.impressions.length > 0 ? client.charts.impressions : [0, 0, 0, 0];
    const followersData = client.charts.followers.length > 0 ? client.charts.followers : [client.metrics.followers, client.metrics.followers, client.metrics.followers, client.metrics.followers];

    // Impressions line chart
    impressionsChartInstance = new Chart(ctxImp, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: 'Impressions',
                data: impressionsData,
                borderColor: '#3b82f6',
                backgroundColor: 'rgba(59, 130, 246, 0.08)',
                borderWidth: 3,
                fill: true,
                tension: 0.35,
                pointRadius: 4,
                pointBackgroundColor: '#3b82f6',
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: textColor, font: { family: 'Poppins', size: 11 } }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Poppins', size: 11 } }
                }
            }
        }
    });

    // Followers cumulative line chart
    followersChartInstance = new Chart(ctxFol, {
        type: 'line',
        data: {
            labels: dates,
            datasets: [{
                label: 'Total Followers',
                data: followersData,
                borderColor: '#10b981',
                backgroundColor: 'rgba(16, 185, 129, 0.08)',
                borderWidth: 3,
                fill: true,
                tension: 0.2,
                pointRadius: 4,
                pointBackgroundColor: '#10b981',
                pointHoverRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                x: {
                    grid: { display: false },
                    ticks: { color: textColor, font: { family: 'Poppins', size: 11 } }
                },
                y: {
                    grid: { color: gridColor },
                    ticks: { color: textColor, font: { family: 'Poppins', size: 11 } }
                }
            }
        }
    });
}

// ==========================================================================
// CALCULATOR FORMULAS
// ==========================================================================
function calculateEngagementRate(client) {
    if (client.metrics.impressions === 0) return '0.00';
    const sum = (client.metrics.reactions || 0) + (client.metrics.comments || 0) + (client.metrics.shares || 0);
    return ((sum / client.metrics.impressions) * 100).toFixed(2);
}

function calculateHealthScore(client) {
    let score = 0;
    
    // 1. Posting Frequency (Max 25 points)
    // 2+ posts per week is ideal (8 posts in 30 days)
    const posts = client.metrics.posts;
    if (posts >= 12) score += 25;
    else if (posts >= 8) score += 20;
    else if (posts >= 4) score += 12;
    else if (posts >= 1) score += 5;
    
    // 2. Engagement Rate (Max 30 points)
    const er = parseFloat(calculateEngagementRate(client));
    if (er >= 4.0) score += 30;
    else if (er >= 2.5) score += 25;
    else if (er >= 1.5) score += 18;
    else if (er >= 0.7) score += 10;
    else if (er > 0) score += 3;
    
    // 3. Comments per Post Ratio (Max 25 points)
    const commRatio = posts > 0 ? (client.metrics.comments / posts) : 0;
    if (commRatio >= 15) score += 25;
    else if (commRatio >= 8) score += 20;
    else if (commRatio >= 4) score += 14;
    else if (commRatio >= 1) score += 7;

    // 4. Followers Growth Velocity (Max 20 points)
    const growth = client.metrics.followersGrowth;
    const baseFol = client.metrics.followers - growth;
    const growthRate = baseFol > 0 ? (growth / baseFol) * 100 : 0;
    if (growthRate >= 2.0) score += 20;
    else if (growthRate >= 1.0) score += 15;
    else if (growthRate >= 0.3) score += 10;
    else if (growthRate > 0) score += 5;

    return Math.min(100, score);
}

function getHealthColor(score) {
    if (score >= 85) return '#10b981'; // Green
    if (score >= 60) return '#f59e0b'; // Amber
    return '#ef4444'; // Red
}

// ==========================================================================
// DRAG AND DROP & CSV PARSER
// ==========================================================================
let uploadedCSVContent = null;
let uploadedCSVFollowers = null;

function setupDragAndDrop() {
    const dropzoneContent = document.getElementById('dropzone-content');
    const dropzoneFollowers = document.getElementById('dropzone-followers');
    
    if (!dropzoneContent || !dropzoneFollowers) return;

    ['dragenter', 'dragover'].forEach(eventName => {
        dropzoneContent.addEventListener(eventName, e => {
            e.preventDefault();
            dropzoneContent.classList.add('dragover');
        }, false);
        
        dropzoneFollowers.addEventListener(eventName, e => {
            e.preventDefault();
            dropzoneFollowers.classList.add('dragover');
        }, false);
    });

    ['dragleave', 'drop'].forEach(eventName => {
        dropzoneContent.addEventListener(eventName, e => {
            e.preventDefault();
            dropzoneContent.classList.remove('dragover');
        }, false);
        
        dropzoneFollowers.addEventListener(eventName, e => {
            e.preventDefault();
            dropzoneFollowers.classList.remove('dragover');
        }, false);
    });

    dropzoneContent.addEventListener('drop', e => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length) {
            document.getElementById('file-content').files = files;
            handleFileSelect('content');
        }
    });

    dropzoneFollowers.addEventListener('drop', e => {
        const dt = e.dataTransfer;
        const files = dt.files;
        if (files.length) {
            document.getElementById('file-followers').files = files;
            handleFileSelect('followers');
        }
    });
}

// Helper to find the best sheet in a workbook by scanning for keyword matches in the first few rows
function findBestSheet(workbook, keywords) {
    let bestSheetName = workbook.SheetNames[0];
    let maxMatches = -1;
    
    for (const name of workbook.SheetNames) {
        const worksheet = workbook.Sheets[name];
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, range: 0 });
        if (rows.length === 0) continue;
        
        let matches = 0;
        // Scan first 10 rows for matches
        for (let i = 0; i < Math.min(10, rows.length); i++) {
            const row = rows[i];
            if (!Array.isArray(row)) continue;
            for (const cell of row) {
                if (cell === null || cell === undefined) continue;
                const cellStr = String(cell).toLowerCase();
                for (const kw of keywords) {
                    if (cellStr.includes(kw)) {
                        matches++;
                    }
                }
            }
        }
        
        if (matches > maxMatches) {
            maxMatches = matches;
            bestSheetName = name;
        }
    }
    
    return bestSheetName;
}

async function handleFileSelect(type) {
    const fileInput = document.getElementById(`file-${type}`);
    const dropzone = document.getElementById(`dropzone-${type}`);
    const label = document.getElementById(`label-${type}-file`);
    
    if (fileInput.files.length === 0) return;
    
    const files = Array.from(fileInput.files);
    label.textContent = files.map(f => f.name).join(', ');
    
    try {
        let combinedRows = [];
        for (const file of files) {
            const rows = await parseFileAsync(file, type);
            combinedRows = combinedRows.concat(rows);
        }
        
        if (type === 'content') {
            uploadedCSVContent = deduplicateContentRows(combinedRows);
            dropzone.classList.add('success');
            showToast(`Content report(s) uploaded: ${uploadedCSVContent.length} unique posts found.`, "check");
        } else {
            uploadedCSVFollowers = deduplicateFollowersRows(combinedRows);
            dropzone.classList.add('success');
            showToast(`Followers report(s) uploaded: ${uploadedCSVFollowers.length} unique dates found.`, "check");
        }
    } catch (err) {
        console.error("Multi-file parse failed", err);
        showToast("Failed to parse some of the files.", "x");
    }
}

function parseNumber(val) {
    if (val === null || val === undefined || val === '') return 0;
    // Strip commas, dots, spaces, and any non-digit characters except minus sign
    const cleaned = String(val).replace(/,/g, '').replace(/\./g, '').replace(/\s/g, '').replace(/[^\d-]/g, '').trim();
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
}

// Helper to find a value in a row by matching lowercase key subsets
function findColumnValue(row, keywords) {
    if (!row) return '';
    const keys = Object.keys(row);
    for (const kw of keywords) {
        const matchedKey = keys.find(k => k.includes(kw));
        if (matchedKey && row[matchedKey] !== undefined) {
            return row[matchedKey];
        }
    }
    return '';
}

// Custom follower column matcher to prevent collision with "new followers"
function findFollowerColumnValue(row, isTotal) {
    if (!row) return '';
    const rowKeys = Object.keys(row);
    
    if (isTotal) {
        // Precise keys first
        const preciseKeys = [
            'life time total followers', 'lifetime total followers', 'total followers', 
            'total de seguidores', 'lifetime total', 'life time total', 'mتابع'
        ];
        for (const pk of preciseKeys) {
            const match = rowKeys.find(rk => rk.toLowerCase() === pk);
            if (match) return row[match];
        }
        for (const pk of preciseKeys) {
            const match = rowKeys.find(rk => rk.toLowerCase().includes(pk));
            if (match) return row[match];
        }
        
        // Fallback to "followers" keywords, but exclude columns containing new/growth keywords
        const fallbackKeys = ['followers', 'seguidores', 'abonnés'];
        for (const fk of fallbackKeys) {
            const match = rowKeys.find(rk => {
                const lrk = rk.toLowerCase();
                if (!lrk.includes(fk)) return false;
                const blacklist = ['new', 'net', 'growth', 'gained', 'zuwachs', 'nuevos', 'nouveaux', 'neue', 'nouveau', 'tendance'];
                return !blacklist.some(b => lrk.includes(b));
            });
            if (match) return row[match];
        }
    } else {
        const newKeys = [
            'new followers', 'net new followers', 'net new', 'gained', 'zuwachs', 
            'nouveaux abonnés', 'neue follower', 'nuevos seguidores', 'follower-zuwachs',
            'nouveaux', 'neue', 'nuevos'
        ];
        for (const nk of newKeys) {
            const match = rowKeys.find(rk => rk.toLowerCase().includes(nk));
            if (match) return row[match];
        }
    }
    return '';
}

// Parse date string into timestamp, supporting international formats (DD/MM/YYYY)
function parseDateToTimestamp(dtStr) {
    if (!dtStr) return 0;
    dtStr = dtStr.trim();
    
    // Check standard JS parser first
    const d = new Date(dtStr);
    if (!isNaN(d.getTime())) {
        return d.getTime();
    }
    
    // Manual parsing for DD/MM/YYYY or DD-MM-YYYY or DD.MM.YYYY
    const match = dtStr.match(/^(\d{1,2})[-/\.](\d{1,2})[-/\.](\d{2,4})$/);
    if (match) {
        let p1 = parseInt(match[1]);
        let p2 = parseInt(match[2]);
        let year = parseInt(match[3]);
        if (year < 100) year += 2000;
        
        if (p1 > 12) {
            // DD/MM/YYYY
            const day = p1;
            const month = p2 - 1;
            return new Date(year, month, day).getTime();
        }
        // Default to MM/DD/YYYY
        const month = p1 - 1;
        const day = p2;
        return new Date(year, month, day).getTime();
    }
    return 0;
}

// Sort followers chronologically by Date (filtering out metadata/empty date rows)
function sortFollowersChronologically(rows) {
    const validRows = [];
    rows.forEach(row => {
        const dtStr = findColumnValue(row, ['date', 'time', 'day', 'month', 'fecha', 'datum', 'data', 'التاريخ']);
        if (dtStr) {
            const timestamp = parseDateToTimestamp(dtStr);
            if (timestamp > 0) {
                validRows.push({ row, timestamp });
            }
        }
    });
    return validRows.sort((a, b) => a.timestamp - b.timestamp).map(x => x.row);
}

// Merge and deduplicate content posts by unique URL, keeping the record with highest impressions
function deduplicateContentRows(rows) {
    const uniquePosts = {};
    rows.forEach(row => {
        const link = findColumnValue(row, ['post link', 'update-link', 'link', 'enlace', 'lien', 'رابط']);
        const impressions = parseNumber(findColumnValue(row, ['impressions', 'impresiones', 'impressionen', 'visualizzazioni', 'visualizações', 'impressões', 'مشاهدات']));
        
        if (link) {
            const cleanedLink = link.trim().toLowerCase();
            if (!uniquePosts[cleanedLink] || impressions > uniquePosts[cleanedLink].impressions) {
                uniquePosts[cleanedLink] = { row, impressions };
            }
        } else {
            const key = Math.random().toString();
            uniquePosts[key] = { row, impressions: 0 };
        }
    });
    return Object.values(uniquePosts).map(x => x.row);
}

// Deduplicate follower rows by Date key
function deduplicateFollowersRows(rows) {
    const uniqueDates = {};
    rows.forEach(row => {
        const dt = findColumnValue(row, ['date', 'time', 'day', 'month', 'fecha', 'datum', 'data', 'التاريخ']);
        if (dt) {
            const normalizedDate = dt.trim().split(' ')[0].toLowerCase();
            const tf = parseNumber(findFollowerColumnValue(row, true));
            if (!uniqueDates[normalizedDate] || tf > uniqueDates[normalizedDate].followers) {
                uniqueDates[normalizedDate] = { row, followers: tf };
            }
        } else {
            const key = Math.random().toString();
            uniqueDates[key] = { row, followers: 0 };
        }
    });
    return Object.values(uniqueDates).map(x => x.row);
}

// Asynchronously parse CSV or Excel file
function parseFileAsync(file, type) {
    return new Promise((resolve, reject) => {
        const isExcel = file.name.endsWith('.xlsx') || file.name.endsWith('.xls');
        const reader = new FileReader();
        
        reader.onload = function(e) {
            if (isExcel) {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });
                    
                    let targetKeywords = [];
                    if (type === 'content') {
                        targetKeywords = [
                            'impressions', 'publish date', 'post link', 'comments', 'reactions',
                            'impresiones', 'fecha', 'enlace', 'comentarios', 'reacciones',
                            'impressionen', 'datum', 'link', 'kommentare', 'reaktionen',
                            'visualizzazioni', 'commenti', 'reazioni', 'partages',
                            'impressões', 'visualizações', 'comentários', 'reações',
                            'مشاهدات', 'تاريخ', 'رابط', 'تعليقات', 'تفاعلات'
                        ];
                    } else {
                        targetKeywords = [
                            'total followers', 'followers', 'new followers', 'net new',
                            'seguidores', 'abonnés', 'mتابع', 'delingen', 'neue'
                        ];
                    }
                    
                    const sheetName = findBestSheet(workbook, targetKeywords);
                    const worksheet = workbook.Sheets[sheetName];
                    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
                    
                    const text = rows.map(row => 
                        row.map(val => {
                            const strVal = val === null || val === undefined ? '' : String(val);
                            return '"' + strVal.replace(/"/g, '""') + '"';
                        }).join(',')
                    ).join('\n');
                    
                    resolve(parseCSV(text));
                } catch (err) {
                    reject(err);
                }
            } else {
                resolve(parseCSV(e.target.result));
            }
        };
        
        reader.onerror = () => reject(new Error("File read error"));
        
        if (isExcel) {
            reader.readAsArrayBuffer(file);
        } else {
            reader.readAsText(file);
        }
    });
}


// Custom CSV Parser that auto-detects delimiter and searches for header row to avoid metadata lines
function parseCSV(text) {
    const lines = text.split(/\r?\n/);
    if (lines.length === 0) return [];
    
    // Auto-detect delimiter: check if semicolons are more frequent than commas in first few lines
    let delimiter = ',';
    let commaCount = 0;
    let semicolonCount = 0;
    for (let i = 0; i < Math.min(5, lines.length); i++) {
        commaCount += (lines[i].match(/,/g) || []).length;
        semicolonCount += (lines[i].match(/;/g) || []).length;
    }
    if (semicolonCount > commaCount) {
        delimiter = ';';
    }
    
    let headerIdx = -1;
    let headers = [];
    
    // Scan first 15 lines for the true headers
    for (let i = 0; i < Math.min(15, lines.length); i++) {
        const cols = parseCSVLine(lines[i], delimiter);
        const matched = cols.some(c => {
            const lc = c.toLowerCase();
            return lc.includes('impressions') || 
                   lc.includes('impresiones') || 
                   lc.includes('impressionen') || 
                   lc.includes('visualizzazioni') || 
                   lc.includes('visualizações') || 
                   lc.includes('impressões') || 
                   lc.includes('مشاهدات') || 
                   lc.includes('ظهور') || 
                   lc.includes('weergaven') ||
                   lc.includes('publish date') || 
                   lc.includes('fecha de publicación') || 
                   lc.includes('date de publication') || 
                   lc.includes('veröffentlichungsdatum') || 
                   lc.includes('data di pubblicazione') || 
                   lc.includes('data de publicação') || 
                   lc.includes('تاريخ النشر') || 
                   lc.includes('post link') || 
                   lc.includes('update-link') || 
                   lc.includes('lien de la') || 
                   lc.includes('enlace de') || 
                   lc.includes('link dell\'') || 
                   lc.includes('رابط المنشور') || 
                   lc.includes('total followers') ||
                   lc.includes('lifetime total followers') ||
                   lc.includes('life time total') ||
                   lc.includes('seguidores') ||
                   lc.includes('abonnés') ||
                   lc.includes('mتابع') ||
                   lc.includes('net new followers') ||
                   lc.includes('new followers');
        });
        if (matched) {
            headerIdx = i;
            headers = cols.map(c => c.trim().toLowerCase());
            break;
        }
    }
    
    // Fallback if no matching header found
    if (headerIdx === -1) {
        headers = parseCSVLine(lines[0], delimiter).map(c => c.trim().toLowerCase());
        headerIdx = 0;
    }
    
    const data = [];
    for (let i = headerIdx + 1; i < lines.length; i++) {
        const line = lines[i].trim();
        if (!line) continue;
        
        const cols = parseCSVLine(line, delimiter);
        const obj = {};
        
        headers.forEach((h, idx) => {
            if (idx < cols.length) {
                obj[h] = cols[idx];
            } else {
                obj[h] = '';
            }
        });
        data.push(obj);
    }
    return data;
}

function parseCSVLine(line, delimiter = ',') {
    const arr = [];
    let quote = false;
    let val = '';
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        if (char === '"') {
            quote = !quote;
        } else if (char === delimiter && !quote) {
            arr.push(val.replace(/^"|"$/g, '').trim());
            val = '';
        } else {
            val += char;
        }
    }
    arr.push(val.replace(/^"|"$/g, '').trim());
    return arr;
}

// ==========================================================================
// CLIENT SETUP WIZARD PROCESS
// ==========================================================================
function resetWizard() {
    appState.wizardStep = 1;
    appState.wizardData = {
        name: '',
        headline: '',
        profileUrl: '',
        metrics: { followers: 0, followersGrowth: 0, impressions: 0, comments: 0, reactions: 0, shares: 0, posts: 0 },
        charts: { dates: [], impressions: [], followers: [] },
        topPosts: []
    };
    uploadedCSVContent = null;
    uploadedCSVFollowers = null;
    
    // Reset forms and view
    document.getElementById('client-setup-form').reset();
    document.getElementById('dropzone-content').className = 'dropzone';
    document.getElementById('dropzone-followers').className = 'dropzone';
    document.getElementById('label-content-file').textContent = 'Content Report (CSV / Excel)';
    document.getElementById('label-followers-file').textContent = 'Followers Report (CSV / Excel)';
    
    setEntryMethod('csv');
    wizardStep(1);
}

function setEntryMethod(method) {
    appState.wizardEntryMethod = method;
    
    const btnCSV = document.getElementById('btn-choice-csv');
    const btnManual = document.getElementById('btn-choice-manual');
    const panelCSV = document.getElementById('data-panel-csv');
    const panelManual = document.getElementById('data-panel-manual');
    
    if (method === 'csv') {
        btnCSV.className = 'btn btn-primary';
        btnManual.className = 'btn btn-secondary';
        panelCSV.style.display = 'block';
        panelManual.style.display = 'none';
    } else {
        btnCSV.className = 'btn btn-secondary';
        btnManual.className = 'btn btn-primary';
        panelCSV.style.display = 'none';
        panelManual.style.display = 'block';
    }
}

function wizardStep(step) {
    appState.wizardStep = step;
    
    // Update step panels visibility
    document.querySelectorAll('.wizard-panel').forEach((panel, idx) => {
        if (idx === (step - 1)) {
            panel.classList.add('active');
        } else {
            panel.classList.remove('active');
        }
    });
    
    // Update step numbers UI
    for (let i = 1; i <= 3; i++) {
        const indicator = document.getElementById(`step-indicator-${i}`);
        if (i < step) {
            indicator.className = 'wizard-step completed';
            indicator.innerHTML = '✓';
        } else if (i === step) {
            indicator.className = 'wizard-step active';
            indicator.innerHTML = i;
        } else {
            indicator.className = 'wizard-step';
            indicator.innerHTML = i;
        }
    }
}

function validateStep1() {
    const name = document.getElementById('input-client-name').value.trim();
    if (!name) {
        showToast("Please enter the client's name", "alert");
        return;
    }
    appState.wizardData.name = name;
    appState.wizardData.headline = document.getElementById('input-client-headline').value.trim();
    appState.wizardData.profileUrl = document.getElementById('input-client-profile-url').value.trim();
    
    const periodType = document.getElementById('input-reporting-period-type').value;
    if (periodType === 'monthly') {
        const monthVal = document.getElementById('input-reporting-month').value;
        if (!monthVal) {
            showToast("Please select a month for the report", "alert");
            return;
        }
        appState.wizardData.dateRange = formatMonthString(monthVal);
    } else {
        appState.wizardData.dateRange = '';
    }
    
    wizardStep(2);
}

function validateStep2() {
    if (appState.wizardEntryMethod === 'manual') {
        // Retrieve manual numbers
        const followers = parseInt(document.getElementById('input-manual-followers').value) || 0;
        const posts = parseInt(document.getElementById('input-manual-posts').value) || 0;
        const impressions = parseInt(document.getElementById('input-manual-impressions').value) || 0;
        const comments = parseInt(document.getElementById('input-manual-comments').value) || 0;
        const reactions = parseInt(document.getElementById('input-manual-reactions').value) || 0;
        const shares = parseInt(document.getElementById('input-manual-shares').value) || 0;
        const ctr = parseFloat(document.getElementById('input-manual-ctr').value) || 0.0;
        const profileViews = parseInt(document.getElementById('input-manual-profile-views').value) || 0;
        
        if (followers <= 0 || posts <= 0 || impressions <= 0) {
            showToast("Followers, Posts and Impressions must be greater than 0", "alert");
            return;
        }
        
        appState.wizardData.metrics = {
            followers: followers,
            followersGrowth: Math.round(followers * 0.02), // mock 2% growth
            impressions: impressions,
            comments: comments,
            reactions: reactions,
            shares: shares,
            posts: posts,
            ctr: ctr,
            profileViews: profileViews
        };
        
        // Mock daily chart numbers based on totals
        const dates = [];
        const impChart = [];
        const folChart = [];
        let runningFol = followers - Math.round(followers * 0.02);
        
        for (let i = 1; i <= 7; i++) {
            dates.push(`Day ${i * 4}`);
            impChart.push(Math.round(impressions / 7 * (0.7 + Math.random() * 0.6)));
            runningFol += Math.round((followers * 0.02) / 7);
            folChart.push(runningFol);
        }
        folChart[folChart.length - 1] = followers; // ensure correct final total
        
        appState.wizardData.charts = {
            dates: dates,
            impressions: impChart,
            followers: folChart
        };
        
        // Mock a couple of top posts
        appState.wizardData.topPosts = [
            { text: `Insights on building a brand as a ${appState.wizardData.headline || 'creator'}`, type: 'text', impressions: Math.round(impressions * 0.5), reactions: Math.round(reactions * 0.5), comments: Math.round(comments * 0.5), shares: Math.round(shares * 0.5) },
            { text: `Case study: Accelerating client growth paths`, type: 'carousel', impressions: Math.round(impressions * 0.3), reactions: Math.round(reactions * 0.3), comments: Math.round(comments * 0.3), shares: Math.round(shares * 0.3) }
        ];
        
        if (!appState.wizardData.dateRange) {
            appState.wizardData.dateRange = 'Last 30 Days (Manual)';
        }
        
    } else {
        // Parse CSV uploads
        if (!uploadedCSVContent) {
            showToast("Please drag & drop your Content CSV report.", "alert");
            return;
        }
        
        // 1. Process Content CSV
        let totalImpressions = 0;
        let totalComments = 0;
        let totalReactions = 0;
        let totalShares = 0;
        let totalClicks = 0;
        let sumCtr = 0;
        let ctrCount = 0;
        let postsCount = 0;
        const postsList = [];
        
        // Chart dates grouping
        const dateImpressionMap = {};
        
        uploadedCSVContent.forEach(row => {
            // Field mapping using flexible keyword matching
            const imp = parseNumber(findColumnValue(row, [
                'impressions', 'views', 'imp', 'impresiones', 'impressionen', 'visualizzazioni', 'visualizações', 'impressões', 'مشاهدات', 'ظهور', 'weergaven'
            ]));
            const comm = parseNumber(findColumnValue(row, [
                'comments', 'comment', 'comm', 'comentarios', 'comentario', 'comen', 'commentaires', 'kommentare', 'kommentar', 'komm', 'commenti', 'comentários', 'تعليقات', 'تعليق', 'commentaar'
            ]));
            const react = parseNumber(findColumnValue(row, [
                'reactions', 'reaction', 'likes', 'like', 'react', 'reacciones', 'reacción', 'me gusta', 'réactions', 'réaction', 'j\'aime', 'reaktionen', 'reaktion', 'gefällt mir', 'reazioni', 'reazione', 'consiglia', 'reações', 'reação', 'gostei', 'تفاعلات', 'تفاعل', 'إعجاب', 'اعجاب', 'reacties'
            ]));
            const sh = parseNumber(findColumnValue(row, [
                'shares', 'share', 'reposts', 'repost', 'compartidos', 'compartir', 'veces compartido', 'recompartidos', 'partages', 'partager', 'geteilt', 'teilung', 'weiterleitungen', 'condivisioni', 'condividi', 'compartilhamentos', 'compartilhar', 'مشاركات', 'مشاركة', 'delingen'
            ]));
            const clicks = parseNumber(findColumnValue(row, [
                'clicks', 'click', 'clics', 'clic', 'klicks', 'klick', 'clicchi', 'cliques', 'clique', 'نقرات', 'نقرة', 'klikken'
            ]));
            const ctrVal = parseFloat(findColumnValue(row, [
                'ctr', 'click-through rate', 'clickthrough rate', 'tasa de clics', 'porcentaje de clics', 'taux de clic', 'taux de clics', 'klickrate', 'tasso di clic', 'taxa de cliques', 'معدل النقر'
            ]));
            
            // Text content
            const text = findColumnValue(row, [
                'post title', 'title', 'content', 'text', 'update title', 'update text', 'post content', 'post description', 'description', 'título de la actualización', 'título', 'texto', 'contenido', 'texte de la mise à jour', 'titre', 'contenu', 'update-text', 'titel', 'inhalt', 'text der aktualisierung', 'testo dell\'aggiornamento', 'titolo', 'texto do compartilhamento', 'conteúdo', 'نص المنشور', 'العنوان', 'نص', 'share update', 'update'
            ]) || findColumnValue(row, [
                'post link', 'url', 'link', 'enlace de la actualización', 'enlace', 'lien de la mise à jour', 'lien', 'update-link', 'link dell\'aggiornamento', 'enlace do compartilhamento', 'رابط المنشور', 'رابط'
            ]) || 'LinkedIn Post';
            
            const link = findColumnValue(row, [
                'post link', 'url', 'link', 'enlace de la actualización', 'enlace', 'lien de la mise à jour', 'lien', 'update-link', 'link dell\'aggiornamento', 'enlace do compartilhamento', 'رابط المنشور', 'رابط'
            ]) || '';
            
            const pubDate = findColumnValue(row, [
                'publish date', 'publish', 'created', 'date', 'time', 'fecha de publicación', 'fecha', 'hora', 'date de publication', 'veröffentlichungsdatum', 'datum', 'zeit', 'data di pubblicazione', 'data de publicação', 'تاريخ النشر', 'التاريخ', 'تاريخ'
            ]);
            
            totalImpressions += imp;
            totalComments += comm;
            totalReactions += react;
            totalShares += sh;
            totalClicks += clicks;
            if (!isNaN(ctrVal) && ctrVal > 0) {
                sumCtr += ctrVal;
                ctrCount++;
            }
            postsCount++;
            
            // Detect post type from LinkedIn's dedicated 'Media type' column first,
            // then fall back to post link URL pattern detection
            const mediaTypeRaw = findColumnValue(row, [
                'media type', 'media', 'post type', 'content type', 'type', 'tipo de contenido', 'tipo de medio', 'tipo', 'type de média', 'type de contenu', 'medientyp', 'typ', 'tipo di elemento multimediale', 'tipo de mídia', 'نوع الوسائط', 'نوع'
            ]);
            let type = 'text';
            if (mediaTypeRaw) {
                const mt = mediaTypeRaw.toString().toLowerCase().trim();
                if (mt.includes('carousel') || mt.includes('document') || mt.includes('pdf') || mt.includes('carrusel') || mt.includes('carrousel') || mt.includes('karussell') || mt.includes('carosello') || mt.includes('carrossel') || mt.includes('documento') || mt.includes('presentación') || mt.includes('présentation') || mt.includes('präsentation') || mt.includes('presentazione') || mt.includes('apresentação') || mt.includes('مستند') || mt.includes('عرض') || mt.includes('كاروسيل')) {
                    type = 'carousel';
                } else if (mt.includes('video') || mt.includes('mp4') || mt.includes('vidéo') || mt.includes('vídeo') || mt.includes('فيديو')) {
                    type = 'video';
                } else if (mt.includes('image') || mt.includes('photo') || mt.includes('picture') || mt.includes('article') || mt.includes('imagen') || mt.includes('fotografía') || mt.includes('bild') || mt.includes('immagine') || mt.includes('imagem') || mt.includes('صورة')) {
                    type = 'image';
                } else if (mt.includes('text') || mt.includes('article') || mt.includes('none') || mt === '') {
                    type = 'text';
                }
            } else {
                // Fallback: infer from post link
                if (link.includes('/video/') || link.includes('/mp4') || link.includes('/watch')) type = 'video';
                else if (link.includes('/photo/') || link.includes('/image/') || link.includes('/post/photo')) type = 'image';
                else if (link.includes('/document/') || link.includes('/pdf')) type = 'carousel';
            }
            
            postsList.push({
                text: text,
                type: type,
                impressions: imp,
                comments: comm,
                reactions: react,
                shares: sh,
                date: pubDate
            });
            
            // Chart accumulation
            if (pubDate) {
                const dateKey = pubDate.split(' ')[0] || pubDate;
                dateImpressionMap[dateKey] = (dateImpressionMap[dateKey] || 0) + imp;
            }
        });

        // 2. Process Followers CSV (optional but useful)
        let totalFollowers = 0;
        let followerGrowth = 0;
        const followerChartDates = [];
        const followerChartVals = [];
        
        if (uploadedCSVFollowers && uploadedCSVFollowers.length > 0) {
            // Sort chronologically by date
            const sortedFollowers = sortFollowersChronologically(uploadedCSVFollowers);
            
            if (sortedFollowers.length > 0) {
                const lastRow = sortedFollowers[sortedFollowers.length - 1];
                const firstRow = sortedFollowers[0];
                
                const lastVal = parseNumber(findFollowerColumnValue(lastRow, true));
                const firstVal = parseNumber(findFollowerColumnValue(firstRow, true));
                
                totalFollowers = lastVal;
                
                // If we have a daily growth column, sum it for the most accurate growth calculation
                let sumNew = 0;
                let hasNewColumn = false;
                sortedFollowers.forEach(r => {
                    const newVal = findFollowerColumnValue(r, false);
                    if (newVal !== '') {
                        hasNewColumn = true;
                        sumNew += parseNumber(newVal);
                    }
                });
                
                if (hasNewColumn && sumNew > 0) {
                    followerGrowth = sumNew;
                } else {
                    followerGrowth = lastVal - firstVal;
                }
                
                // Fallback: If totalFollowers is 0, estimate it
                if (totalFollowers === 0) {
                    totalFollowers = followerGrowth;
                }
            }
            
            // Populate charts
            const hasTotalFollowers = sortedFollowers.length > 0 && findFollowerColumnValue(sortedFollowers[0], true) !== '';
            sortedFollowers.forEach(r => {
                const dt = findColumnValue(r, ['date', 'time', 'day', 'month', 'fecha', 'datum', 'data', 'التاريخ']);
                const tf = parseNumber(findFollowerColumnValue(r, hasTotalFollowers));
                if (dt && tf) {
                    followerChartDates.push(dt.split(' ')[0]);
                    followerChartVals.push(tf);
                }
            });
        } else {
            totalFollowers = postsCount * 350;
            followerGrowth = Math.round(totalFollowers * 0.015);
        }

        // Aggregate charts dates
        const contentDates = Object.keys(dateImpressionMap).sort();
        const contentImpressionVals = contentDates.map(d => dateImpressionMap[d]);
        const computedCtr = totalClicks > 0 ? (totalClicks / totalImpressions) * 100 : (ctrCount > 0 ? sumCtr / ctrCount : 0.0);
        
        appState.wizardData.metrics = {
            followers: totalFollowers,
            followersGrowth: followerGrowth,
            impressions: totalImpressions,
            comments: totalComments,
            reactions: totalReactions,
            shares: totalShares,
            posts: postsCount,
            ctr: computedCtr,
            profileViews: 0
        };
        
        appState.wizardData.charts = {
            dates: contentDates.length > 0 ? contentDates : followerChartDates,
            impressions: contentImpressionVals,
            followers: followerChartVals.length > 0 ? followerChartVals : contentDates.map((_, i) => totalFollowers - followerGrowth + Math.round((followerGrowth/contentDates.length) * i))
        };
        
        appState.wizardData.topPosts = postsList.sort((a,b) => b.impressions - a.impressions).slice(0, 5);
        
        // Guess Date Range from contents
        if (!appState.wizardData.dateRange) {
            if (contentDates.length > 1) {
                appState.wizardData.dateRange = `${contentDates[0]} to ${contentDates[contentDates.length - 1]}`;
            } else {
                appState.wizardData.dateRange = 'Last 30 Days (CSV)';
            }
        }
    }
    
    // Render Step 3 Summary
    const summaryCard = document.getElementById('wizard-summary-card');
    const wData = appState.wizardData;
    const computedEr = ((wData.metrics.reactions + wData.metrics.comments + wData.metrics.shares) / Math.max(1, wData.metrics.impressions) * 100).toFixed(2);
    
    summaryCard.innerHTML = `
        <h4 style="margin-bottom: 12px; border-bottom: 1px solid var(--border-color); padding-bottom: 8px;">Audit Review Details</h4>
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 10px; font-size: 0.85rem;">
            <p><span style="color:var(--text-muted)">Name:</span> <strong>${wData.name}</strong></p>
            <p><span style="color:var(--text-muted)">Followers:</span> <strong>${wData.metrics.followers.toLocaleString()}</strong></p>
            <p><span style="color:var(--text-muted)">Total Posts:</span> <strong>${wData.metrics.posts}</strong></p>
            <p><span style="color:var(--text-muted)">Total Impressions:</span> <strong>${wData.metrics.impressions.toLocaleString()}</strong></p>
            <p><span style="color:var(--text-muted)">Total Comments:</span> <strong>${wData.metrics.comments.toLocaleString()}</strong></p>
            <p><span style="color:var(--text-muted)">Engagement Rate:</span> <strong>${computedEr}%</strong></p>
        </div>
    `;
    
    wizardStep(3);
}

async function saveWizardClient() {
    const finalClient = {
        id: 'client_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
        name: appState.wizardData.name,
        headline: appState.wizardData.headline,
        profileUrl: appState.wizardData.profileUrl,
        dateCreated: new Date().toISOString().split('T')[0],
        dateRange: appState.wizardData.dateRange,
        metrics: { ...appState.wizardData.metrics },
        charts: { ...appState.wizardData.charts },
        topPosts: [ ...appState.wizardData.topPosts ]
    };
    
    await saveClientRecord(finalClient);
    showToast("Client performance audit saved successfully", "check-circle");
    
    // Select and navigate to new client
    selectClient(finalClient.id);
}

// ==========================================================================
// SHARE REPORT URL COMPRESSION / SHARING SYSTEM
// ==========================================================================
function openShareModal() {
    const client = appState.clients.find(c => c.id === appState.activeClientId);
    if (!client) return;

    // Standardize object to keep string size reasonable
    const serializedData = {
        n: client.name,
        h: client.headline,
        u: client.profileUrl,
        r: client.dateRange,
        m: client.metrics,
        c: {
            d: client.charts.dates.slice(-10), // Take last 10 points to fit URL limits
            i: client.charts.impressions.slice(-10),
            f: client.charts.followers.slice(-10)
        },
        t: client.topPosts.slice(0, 3).map(p => ({
            tx: p.text.substring(0, 80),
            ty: p.type,
            im: p.impressions,
            cm: p.comments,
            re: p.reactions,
            sh: p.shares
        }))
    };
    
    try {
        const jsonStr = JSON.stringify(serializedData);
        // Base64 encoding compatible with unicode characters
        const b64 = btoa(unescape(encodeURIComponent(jsonStr)));
        const shareLink = `${window.location.origin}${window.location.pathname}?report=${b64}`;
        
        document.getElementById('share-url-input').value = shareLink;
        
        // Open Modal
        document.getElementById('modal-share').classList.add('active');
        if (typeof lucide !== 'undefined') lucide.createIcons();
    } catch(e) {
        console.error("Encoding error", e);
        showToast("Error generating shareable link.", "x");
    }
}

function loadSharedReport(b64Data) {
    try {
        const decodedJson = decodeURIComponent(escape(atob(b64Data)));
        const raw = JSON.parse(decodedJson);
        
        // Re-construct active client structure from shorter keys
        const mockClient = {
            id: 'shared_report',
            name: raw.n,
            headline: raw.h,
            profileUrl: raw.u,
            dateRange: raw.r,
            metrics: raw.m,
            charts: {
                dates: raw.c.d,
                impressions: raw.c.i,
                followers: raw.c.f
            },
            topPosts: raw.t.map(p => ({
                text: p.tx,
                type: p.ty,
                impressions: p.im,
                comments: p.cm,
                reactions: p.re,
                shares: p.sh
            }))
        };
        
        // Hide primary navigation and sidebar to give a clean dedicated dashboard look
        document.getElementById('main-header').style.display = 'none';
        document.getElementById('view-agency-container').style.display = 'none';
        
        // Display report view in full width
        const reportContainer = document.getElementById('view-report-container');
        reportContainer.style.display = 'flex';
        reportContainer.style.gridColumn = '1 / -1';
        
        // Hide "Share Report" inside the report view (since they are already viewing it)
        const btnShare = reportContainer.querySelector('button[onclick="openShareModal()"]');
        if (btnShare) btnShare.style.display = 'none';
        
        // Render
        renderClientReport(mockClient);
        
        showToast("Shared report loaded successfully.", "check");
    } catch (e) {
        console.error("Failed to decode shared report data", e);
        alert("The shared link is incomplete or corrupted.");
        window.location.href = window.location.origin + window.location.pathname;
    }
}

function copyShareLink() {
    const input = document.getElementById('share-url-input');
    input.select();
    input.setSelectionRange(0, 99999); // mobile
    
    navigator.clipboard.writeText(input.value)
        .then(() => {
            showToast("Report link copied to clipboard!", "check");
            
            // Swap icon to green check temporarily
            const icon = document.getElementById('btn-copy-icon');
            if (icon) {
                icon.setAttribute('data-lucide', 'check');
                if (typeof lucide !== 'undefined') lucide.createIcons();
                setTimeout(() => {
                    icon.setAttribute('data-lucide', 'copy');
                    if (typeof lucide !== 'undefined') lucide.createIcons();
                }, 2000);
            }
        })
        .catch(() => {
            showToast("Failed to copy link.", "x");
        });
}

function printReport() {
    window.print();
}

// ==========================================================================
// MODALS & NOTIFICATIONS CONTROLLER
// ==========================================================================
function openCreateClientModal() {
    document.getElementById('modal-add-client').classList.add('active');
}

function createClientFromModal() {
    const name = document.getElementById('modal-client-name').value.trim();
    const headline = document.getElementById('modal-client-headline').value.trim();
    
    if (!name) {
        showToast("Client Name is required.", "alert");
        return;
    }
    
    closeModal('add-client');
    
    // Pre-populate Step 1 and switch view
    resetWizard();
    document.getElementById('input-client-name').value = name;
    document.getElementById('input-client-headline').value = headline;
    
    switchView('wizard');
}

function closeModal(modalName) {
    document.getElementById(`modal-${modalName}`).classList.remove('active');
}

function openEditClientModal() {
    const client = appState.clients.find(c => c.id === appState.activeClientId);
    if (!client) return;
    
    // Reset tab to Profile and clear re-upload buffers
    switchEditTab('profile');
    _editReuploadContent  = null;
    _editReuploadFollowers = null;
    const statusEl = document.getElementById('edit-upload-status');
    if (statusEl) statusEl.innerHTML = '';
    ['edit-label-content', 'edit-label-followers'].forEach((id, i) => {
        const el = document.getElementById(id);
        if (el) el.textContent = i === 0 ? 'Content Report (CSV / Excel)' : 'Followers Report (CSV / Excel)';
    });
    ['edit-dropzone-content', 'edit-dropzone-followers'].forEach(id => {
        document.getElementById(id)?.classList.remove('uploaded');
    });
    
    // Pre-fill all fields with current client data
    document.getElementById('edit-client-name').value = client.name || '';
    document.getElementById('edit-client-headline').value = client.headline || '';
    document.getElementById('edit-client-url').value = client.profileUrl || '';
    document.getElementById('edit-followers').value = client.metrics.followers || '';
    document.getElementById('edit-followers-growth').value = client.metrics.followersGrowth || '';
    document.getElementById('edit-impressions').value = client.metrics.impressions || '';
    document.getElementById('edit-comments').value = client.metrics.comments || '';
    document.getElementById('edit-reactions').value = client.metrics.reactions || '';
    document.getElementById('edit-reposts').value = client.metrics.shares || '';
    document.getElementById('edit-posts').value = client.metrics.posts || '';
    document.getElementById('edit-ctr').value = client.metrics.ctr || '';
    document.getElementById('edit-profile-views').value = client.metrics.profileViews || '';
    
    // Pre-fill period type
    const monthsList = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const isMonthly = monthsList.some(m => client.dateRange && client.dateRange.includes(m) && !client.dateRange.includes("to") && !client.dateRange.includes("–"));
    
    if (isMonthly) {
        document.getElementById('edit-reporting-period-type').value = 'monthly';
        document.getElementById('edit-date-range-group').style.display = 'none';
        document.getElementById('edit-monthly-picker-group').style.display = 'block';
        
        // Parse month and year from Date Range
        const parts = client.dateRange.split(' ');
        if (parts.length === 2) {
            const mIdx = monthsList.indexOf(parts[0]) + 1;
            const year = parts[1];
            if (mIdx > 0) {
                const mStr = mIdx < 10 ? '0' + mIdx : '' + mIdx;
                document.getElementById('edit-reporting-month').value = `${year}-${mStr}`;
            }
        }
        document.getElementById('edit-date-range').value = '';
    } else {
        document.getElementById('edit-reporting-period-type').value = 'range';
        document.getElementById('edit-date-range-group').style.display = 'block';
        document.getElementById('edit-monthly-picker-group').style.display = 'none';
        document.getElementById('edit-date-range').value = client.dateRange || '';
    }
    
    // Manage Team Access sharing permissions
    const isCurrentOwner = !isCloudMode || !currentUser || !client.ownerEmail || client.ownerEmail === currentUser.email;
    const sharingControls = document.getElementById('owner-only-sharing-controls');
    const warningMsg = document.getElementById('non-owner-sharing-message');
    
    if (isCurrentOwner) {
        if (sharingControls) sharingControls.style.display = 'block';
        if (warningMsg) warningMsg.style.display = 'none';
    } else {
        if (sharingControls) sharingControls.style.display = 'none';
        if (warningMsg) warningMsg.style.display = 'block';
    }
    
    populateCollaboratorsList(client);
    
    document.getElementById('modal-edit-client').classList.add('active');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

async function saveEditClient() {
    const clientIdx = appState.clients.findIndex(c => c.id === appState.activeClientId);
    if (clientIdx === -1) return;
    
    const name = document.getElementById('edit-client-name').value.trim();
    if (!name) {
        showToast("Client Name is required.", "alert");
        return;
    }
    
    const client = appState.clients[clientIdx];
    
    // Update profile details
    client.name = name;
    client.headline = document.getElementById('edit-client-headline').value.trim();
    client.profileUrl = document.getElementById('edit-client-url').value.trim();
    
    const periodType = document.getElementById('edit-reporting-period-type').value;
    if (periodType === 'monthly') {
        const monthVal = document.getElementById('edit-reporting-month').value;
        if (!monthVal) {
            showToast("Please select a month for the report", "alert");
            return;
        }
        client.dateRange = formatMonthString(monthVal);
    } else {
        client.dateRange = document.getElementById('edit-date-range').value.trim();
    }
    
    // Update metrics - use existing value if input is left blank
    const m = client.metrics;
    const getNum = (id, fallback) => {
        const v = document.getElementById(id).value.trim();
        return v !== '' ? parseInt(v) || 0 : fallback;
    };
    
    const getFloat = (id, fallback) => {
        const v = document.getElementById(id).value.trim();
        return v !== '' ? parseFloat(v) || 0.0 : fallback;
    };
    
    client.metrics = {
        followers:      getNum('edit-followers', m.followers),
        followersGrowth: getNum('edit-followers-growth', m.followersGrowth),
        impressions:    getNum('edit-impressions', m.impressions),
        comments:       getNum('edit-comments', m.comments),
        reactions:      getNum('edit-reactions', m.reactions),
        shares:         getNum('edit-reposts', m.shares),
        posts:          getNum('edit-posts', m.posts),
        ctr:            getFloat('edit-ctr', m.ctr || 0.0),
        profileViews:   getNum('edit-profile-views', m.profileViews || 0)
    };
    
    // Update charts to match updated metrics
    if (!client.charts) {
        client.charts = { dates: [], impressions: [], followers: [] };
    }
    
    const dates = client.charts.dates.length > 0 ? client.charts.dates : ['Week 1', 'Week 2', 'Week 3', 'Week 4'];
    client.charts.dates = dates;
    const N = dates.length;
    
    // 1. Adjust Impressions Chart
    const newImpressions = client.metrics.impressions;
    const oldSumImp = (client.charts.impressions || []).reduce((a, b) => a + b, 0);
    
    if (oldSumImp > 0) {
        const scale = newImpressions / oldSumImp;
        client.charts.impressions = client.charts.impressions.map(v => Math.round(v * scale));
        // adjust last item to match exact sum
        const newSum = client.charts.impressions.reduce((a, b) => a + b, 0);
        const diff = newImpressions - newSum;
        if (client.charts.impressions.length > 0) {
            client.charts.impressions[client.charts.impressions.length - 1] += diff;
            if (client.charts.impressions[client.charts.impressions.length - 1] < 0) {
                client.charts.impressions[client.charts.impressions.length - 1] = 0;
            }
        }
    } else {
        const baseVal = Math.floor(newImpressions / N);
        const rem = newImpressions % N;
        client.charts.impressions = Array(N).fill(baseVal);
        for (let i = 0; i < rem; i++) {
            client.charts.impressions[i]++;
        }
    }
    
    // 2. Adjust Followers Chart
    const newFollowers = client.metrics.followers;
    const newFollowersGrowth = client.metrics.followersGrowth;
    const oldFollowersArr = client.charts.followers || [];
    
    if (oldFollowersArr.length > 1) {
        const f_first = oldFollowersArr[0];
        const f_last = oldFollowersArr[oldFollowersArr.length - 1];
        const oldGrowth = f_last - f_first;
        
        if (oldGrowth > 0) {
            client.charts.followers = oldFollowersArr.map(v => {
                const pct = (v - f_first) / oldGrowth;
                return Math.round((newFollowers - newFollowersGrowth) + pct * newFollowersGrowth);
            });
            // Ensure exact final total on the last element
            client.charts.followers[client.charts.followers.length - 1] = newFollowers;
        } else {
            const len = oldFollowersArr.length;
            client.charts.followers = oldFollowersArr.map((_, i) => {
                return Math.round((newFollowers - newFollowersGrowth) + (newFollowersGrowth * i / (len - 1)));
            });
        }
    } else {
        // Generate daily follower values matching length of dates
        client.charts.followers = dates.map((_, i) => {
            if (N > 1) {
                return Math.round((newFollowers - newFollowersGrowth) + (newFollowersGrowth * i / (N - 1)));
            } else {
                return newFollowers;
            }
        });
    }
    
    await saveClientRecord(client);
    closeModal('edit-client');
    
    // Re-render the report with updated data
    renderClientReport(client);
    renderAgencyView();
    
    showToast("Client details and graphs updated successfully!", "check-circle");
}

// ── Edit modal tab switching ───────────────────────────────────────────────
function switchEditTab(tab) {
    const tabs   = ['profile', 'stats', 'upload', 'share'];
    const panels = { profile: 'edit-panel-profile', stats: 'edit-panel-stats', upload: 'edit-panel-upload', share: 'edit-panel-share' };

    tabs.forEach(t => {
        const btn   = document.getElementById(`edit-tab-${t}`);
        const panel = document.getElementById(panels[t]);
        if (t === tab) {
            btn.style.borderBottom = '2px solid var(--primary)';
            btn.style.color        = 'var(--primary)';
            panel.style.display    = 'block';
        } else {
            btn.style.borderBottom = '2px solid transparent';
            btn.style.color        = 'var(--text-secondary)';
            panel.style.display    = 'none';
        }
    });

    if (typeof lucide !== 'undefined') lucide.createIcons();
}

// ── Excel Parser Helper for Edit Re-upload ─────────────────────────────────
function parseXLSX(arrayBuffer, type = 'content') {
    try {
        const data = new Uint8Array(arrayBuffer);
        const workbook = XLSX.read(data, { type: 'array' });
        
        let targetKeywords = [];
        if (type === 'content') {
            targetKeywords = [
                'impressions', 'publish date', 'post link', 'comments', 'reactions',
                'impresiones', 'fecha', 'enlace', 'comentarios', 'reacciones',
                'impressionen', 'datum', 'link', 'kommentare', 'reaktionen',
                'visualizzazioni', 'commenti', 'reazioni', 'partages',
                'impressões', 'visualizações', 'comentários', 'reações',
                'مشاهدات', 'تاريخ', 'رابط', 'تعليقات', 'تفاعلات'
            ];
        } else {
            targetKeywords = [
                'total followers', 'followers', 'new followers', 'net new',
                'seguidores', 'abonnés', 'mتابع', 'delingen', 'neue'
            ];
        }
        
        const sheetName = findBestSheet(workbook, targetKeywords);
        const worksheet = workbook.Sheets[sheetName];
        
        const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1 });
        const text = rows.map(row => 
            row.map(val => {
                const strVal = val === null || val === undefined ? '' : String(val);
                return '"' + strVal.replace(/"/g, '""') + '"';
            }).join(',')
        ).join('\n');
        
        return parseCSV(text);
    } catch (err) {
        console.error("Excel parsing failed", err);
        showToast("Failed to parse Excel file.", "x");
        return [];
    }
}

// ── Re-upload file selection inside the edit modal ────────────────────────
// Stores parsed rows temporarily until the user clicks "Apply"
let _editReuploadContent  = null;
let _editReuploadFollowers = null;

async function handleEditFileSelect(type) {
    const inputId  = type === 'content' ? 'edit-file-content' : 'edit-file-followers';
    const labelId  = type === 'content' ? 'edit-label-content' : 'edit-label-followers';
    const zoneId   = type === 'content' ? 'edit-dropzone-content' : 'edit-dropzone-followers';
    const statusEl = document.getElementById('edit-upload-status');
    const files    = Array.from(document.getElementById(inputId).files);
    
    if (files.length === 0) return;

    document.getElementById(labelId).textContent = `✅ ${files.map(f => f.name).join(', ')}`;
    document.getElementById(zoneId).classList.add('uploaded');

    try {
        let combinedRows = [];
        for (const file of files) {
            const rows = await parseFileAsync(file, type);
            combinedRows = combinedRows.concat(rows);
        }
        
        if (type === 'content') {
            _editReuploadContent = deduplicateContentRows(combinedRows);
        } else {
            _editReuploadFollowers = deduplicateFollowersRows(combinedRows);
        }
        updateEditUploadStatus(statusEl);
    } catch (err) {
        console.error("Edit multi-file parse failed", err);
        showToast("Failed to parse some of the files.", "x");
    }
}

function updateEditUploadStatus(el) {
    const parts = [];
    if (_editReuploadContent)   parts.push(`📄 Content report: <strong>${_editReuploadContent.length} rows</strong> ready`);
    if (_editReuploadFollowers) parts.push(`👥 Followers report: <strong>${_editReuploadFollowers.length} rows</strong> ready`);
    el.innerHTML = parts.join('<br>');
}

// ── Apply re-uploaded files and recalculate metrics ───────────────────────
function applyReuploadedFiles() {
    if (!_editReuploadContent && !_editReuploadFollowers) {
        showToast("Please select at least one file to upload.", "alert");
        return;
    }

    const clientIdx = appState.clients.findIndex(c => c.id === appState.activeClientId);
    if (clientIdx === -1) return;

    const client = appState.clients[clientIdx];

    // Use newly uploaded files OR fall back to empty array (keeps zero for that metric)
    const contentRows   = _editReuploadContent  || [];
    const followerRows  = _editReuploadFollowers || [];

    // ── Recalculate content metrics ──
    let totalImpressions = 0, totalComments = 0, totalReactions = 0, totalShares = 0;
    let postsCount = 0;
    const postsList = [];
    const dateImpressionMap = {};

    contentRows.forEach(row => {
        const imp   = parseNumber(findColumnValue(row, [
            'impressions', 'views', 'imp', 'impresiones', 'impressionen', 'visualizzazioni', 'visualizações', 'impressões', 'مشاهدات', 'ظهور', 'weergaven'
        ]));
        const comm  = parseNumber(findColumnValue(row, [
            'comments', 'comment', 'comm', 'comentarios', 'comentario', 'comen', 'commentaires', 'kommentare', 'kommentar', 'komm', 'commenti', 'comentários', 'تعليقات', 'تعليق', 'commentaar'
        ]));
        const react = parseNumber(findColumnValue(row, [
            'reactions', 'reaction', 'likes', 'like', 'react', 'reacciones', 'reacción', 'me gusta', 'réactions', 'réaction', 'j\'aime', 'reaktionen', 'reaktion', 'gefällt mir', 'reazioni', 'reazione', 'consiglia', 'reações', 'reação', 'gostei', 'تفاعلات', 'تفاعل', 'إعجاب', 'اعجاب', 'reacties'
        ]));
        const sh    = parseNumber(findColumnValue(row, [
            'shares', 'share', 'reposts', 'repost', 'compartidos', 'compartir', 'veces compartido', 'recompartidos', 'partages', 'partager', 'geteilt', 'teilung', 'weiterleitungen', 'condivisioni', 'condividi', 'compartilhamentos', 'compartilhar', 'مشاركات', 'مشاركة', 'delingen'
        ]));
        const text  = findColumnValue(row, [
            'post title', 'title', 'content', 'text', 'update title', 'update text', 'post content', 'post description', 'description', 'título de la actualización', 'título', 'texto', 'contenido', 'texte de la mise à jour', 'titre', 'contenu', 'update-text', 'titel', 'inhalt', 'text der aktualisierung', 'testo dell\'aggiornamento', 'titolo', 'texto do compartilhamento', 'conteúdo', 'نص المنشور', 'العنوان', 'نص', 'share update', 'update'
        ]) || findColumnValue(row, [
            'post link', 'url', 'link', 'enlace de la actualización', 'enlace', 'lien de la mise à jour', 'lien', 'update-link', 'link dell\'aggiornamento', 'enlace do compartilhamento', 'رابط المنشور', 'رابط'
        ]) || 'LinkedIn Post';
        const link  = findColumnValue(row, [
            'post link', 'url', 'link', 'enlace de la actualización', 'enlace', 'lien de la mise à jour', 'lien', 'update-link', 'link dell\'aggiornamento', 'enlace do compartilhamento', 'رابط المنشور', 'رابط'
        ]) || '';
        const pubDate = findColumnValue(row, [
            'publish date', 'publish', 'created', 'date', 'time', 'fecha de publicação', 'fecha', 'hora', 'date de publication', 'veröffentlichungsdatum', 'datum', 'zeit', 'data di pubblicazione', 'data de publicação', 'تاريخ النشر', 'التاريخ', 'تاريخ'
        ]);

        totalImpressions += imp; totalComments += comm;
        totalReactions   += react; totalShares += sh; postsCount++;

        const mediaTypeRaw = findColumnValue(row, [
            'media type', 'media', 'post type', 'content type', 'type', 'tipo de contenido', 'tipo de medio', 'tipo', 'type de média', 'type de contenu', 'medientyp', 'typ', 'tipo di elemento multimediale', 'tipo de mídia', 'نوع الوسائط', 'نوع'
        ]);
        let type = 'text';
        if (mediaTypeRaw) {
            const mt = mediaTypeRaw.toString().toLowerCase().trim();
            if (mt.includes('carousel') || mt.includes('document') || mt.includes('pdf') || mt.includes('carrusel') || mt.includes('carrousel') || mt.includes('karussell') || mt.includes('carosello') || mt.includes('carrossel') || mt.includes('documento') || mt.includes('presentación') || mt.includes('présentation') || mt.includes('präsentation') || mt.includes('presentazione') || mt.includes('apresentação') || mt.includes('مستند') || mt.includes('عرض') || mt.includes('كاروسيل')) {
                type = 'carousel';
            } else if (mt.includes('video') || mt.includes('mp4') || mt.includes('vidéo') || mt.includes('vídeo') || mt.includes('فيديو')) {
                type = 'video';
            } else if (mt.includes('image') || mt.includes('photo') || mt.includes('picture') || mt.includes('article') || mt.includes('imagen') || mt.includes('fotografía') || mt.includes('bild') || mt.includes('immagine') || mt.includes('imagem') || mt.includes('صورة')) {
                type = 'image';
            } else if (mt.includes('text') || mt.includes('article') || mt.includes('none') || mt === '') {
                type = 'text';
            }
        } else {
            if (link.includes('/video/') || link.includes('/mp4') || link.includes('/watch')) type = 'video';
            else if (link.includes('/photo/') || link.includes('/image/') || link.includes('/post/photo')) type = 'image';
            else if (link.includes('/document/') || link.includes('/pdf')) type = 'carousel';
        }

        postsList.push({ text, type, impressions: imp, comments: comm, reactions: react, shares: sh, date: pubDate });

        if (pubDate) {
            const dk = pubDate.split(' ')[0];
            dateImpressionMap[dk] = (dateImpressionMap[dk] || 0) + imp;
        }
    });

    // ── Recalculate follower metrics ──
    let totalFollowers = client.metrics.followers;
    let followerGrowth = client.metrics.followersGrowth;
    const followerChartDates = [], followerChartVals = [];

    if (followerRows.length > 0) {
        // Sort chronologically by date
        const sortedFollowers = sortFollowersChronologically(followerRows);
        
        if (sortedFollowers.length > 0) {
            const lastRow  = sortedFollowers[sortedFollowers.length - 1];
            const firstRow = sortedFollowers[0];
            
            const lastVal  = parseNumber(findFollowerColumnValue(lastRow, true));
            const firstVal = parseNumber(findFollowerColumnValue(firstRow, true));
            
            totalFollowers = lastVal || totalFollowers;
            
            // If we have a daily growth column, sum it for the most accurate growth calculation
            let sumNew = 0;
            let hasNewColumn = false;
            sortedFollowers.forEach(r => {
                const newVal = findFollowerColumnValue(r, false);
                if (newVal !== '') {
                    hasNewColumn = true;
                    sumNew += parseNumber(newVal);
                }
            });
            
            if (hasNewColumn && sumNew > 0) {
                followerGrowth = sumNew;
            } else if (lastVal > 0) {
                followerGrowth = lastVal - firstVal;
            }
            
            // Fallback: If totalFollowers is 0, estimate it
            if (totalFollowers === 0) {
                totalFollowers = followerGrowth;
            }
        }
    }

        const hasTotalFollowers = sortedFollowers.length > 0 && findFollowerColumnValue(sortedFollowers[0], true) !== '';
        sortedFollowers.forEach(r => {
            const dt = findColumnValue(r, ['date', 'time', 'day', 'month', 'fecha', 'datum', 'data', 'التاريخ']);
            const tf = parseNumber(findFollowerColumnValue(r, hasTotalFollowers));
            if (dt && tf) { 
                followerChartDates.push(dt.split(' ')[0]); 
                followerChartVals.push(tf); 
            }
        });
    }

    const contentDates         = Object.keys(dateImpressionMap).sort();
    const contentImpressionVals = contentDates.map(d => dateImpressionMap[d]);

    // Ensure client.charts exists
    if (!client.charts) {
        client.charts = { dates: [], impressions: [], followers: [] };
    }

    // ── Merge into client record ──
    if (contentRows.length > 0) {
        client.metrics.impressions = totalImpressions;
        client.metrics.comments    = totalComments;
        client.metrics.reactions   = totalReactions;
        client.metrics.shares      = totalShares;
        client.metrics.posts       = postsCount;
        client.topPosts            = postsList.sort((a,b) => b.impressions - a.impressions).slice(0, 5);
        client.charts.dates        = contentDates;
        client.charts.impressions  = contentImpressionVals;
        
        // Update date range
        if (contentDates.length > 1) {
            client.dateRange = `${contentDates[0]} to ${contentDates[contentDates.length - 1]}`;
        }

        // If follower list is empty or doesn't match content dates length, generate cumulative followers values
        if (!client.charts.followers || client.charts.followers.length !== contentDates.length) {
            const currentFollowers = client.metrics.followers;
            const currentGrowth = client.metrics.followersGrowth;
            client.charts.followers = contentDates.map((_, i) => {
                const len = contentDates.length;
                if (len > 1) {
                    return currentFollowers - currentGrowth + Math.round((currentGrowth / (len - 1)) * i);
                } else {
                    return currentFollowers;
                }
            });
        }
    }

    if (followerRows.length > 0) {
        client.metrics.followers      = totalFollowers;
        client.metrics.followersGrowth = followerGrowth;
        
        if (contentRows.length === 0) {
            client.charts.dates = followerChartDates;
        }
        client.charts.followers = followerChartVals;
        
        // If content dates were not updated, fill with 0s or keep previous matching length
        if (contentRows.length === 0 && (!client.charts.impressions || client.charts.impressions.length !== followerChartDates.length)) {
            client.charts.impressions = followerChartDates.map(() => 0);
        }
    }

    appState.clients[clientIdx] = client;
    saveClientsToStorage();

    // Reset temp buffers
    _editReuploadContent = null;
    _editReuploadFollowers = null;
    document.getElementById('edit-upload-status').innerHTML = '';

    closeModal('edit-client');
    renderClientReport(client);
    renderAgencyView();

    showToast("Report re-imported and dashboard updated!", "check-circle");
}

function showTutorial() {
    document.getElementById('modal-tutorial').classList.add('active');
    if (typeof lucide !== 'undefined') lucide.createIcons();
}

function showToast(message, iconName = 'check') {
    const toast = document.getElementById('toast-notification');
    const toastMsg = document.getElementById('toast-message');
    
    toastMsg.textContent = message;
    toast.className = 'toast show';
    
    // Set matching icon if Lucide is loaded
    const toastIcon = toast.querySelector('i');
    if (toastIcon && typeof lucide !== 'undefined') {
        toastIcon.setAttribute('data-lucide', iconName === 'check' ? 'check-circle' : iconName);
        lucide.createIcons();
    }
    
    setTimeout(() => {
        toast.className = 'toast';
    }, 3500);
}

// ==========================================================================
// SEEDING DUMMY CLIENT DATA
// ==========================================================================
function getDemoClients() {
    return [
        {
            id: 'demo_client_1',
            name: 'Alex Rivera',
            headline: 'SaaS Founder & Creator | ScaleTech Solutions',
            profileUrl: 'https://www.linkedin.com/in/alex-rivera-demo',
            dateCreated: '2026-06-01',
            dateRange: 'May 2026',
            metrics: {
                followers: 12450,
                followersGrowth: 385,
                impressions: 84200,
                comments: 245,
                reactions: 980,
                shares: 54,
                posts: 14,
                ctr: 1.25,
                profileViews: 350
            },
            charts: {
                dates: ['May 02', 'May 06', 'May 10', 'May 14', 'May 18', 'May 22', 'May 26', 'May 30'],
                impressions: [4200, 6800, 11000, 9500, 14200, 12500, 16800, 9200],
                followers: [12065, 12110, 12180, 12230, 12290, 12340, 12400, 12450]
            },
            topPosts: [
                { text: 'We scaled our customer base to 10k users without spending a single dollar on ads. Here is the step-by-step framework we used...', type: 'carousel', impressions: 32000, reactions: 410, comments: 112, shares: 35, date: '2026-05-14' },
                { text: 'Stop optimizing for comments, start optimizing for conversations. LinkedIn is a networking event, not a broadcasting station.', type: 'text', impressions: 21500, reactions: 290, comments: 84, shares: 12, date: '2026-05-22' },
                { text: 'Behind the scenes at our virtual team hackathon. We built 3 prototypes in 24 hours. Proud of the ScaleTech crew!', type: 'image', impressions: 16200, reactions: 180, comments: 32, shares: 4, date: '2026-05-06' }
            ]
        },
        {
            id: 'demo_client_2',
            name: 'Sarah Jenkins',
            headline: 'Director of Business Development | Enterprise Sales Coach',
            profileUrl: 'https://www.linkedin.com/in/sarah-jenkins-demo',
            dateCreated: '2026-06-03',
            dateRange: 'May 2026',
            metrics: {
                followers: 4320,
                followersGrowth: 42,
                impressions: 18200,
                comments: 31,
                reactions: 145,
                shares: 8,
                posts: 5,
                ctr: 0.85,
                profileViews: 110
            },
            charts: {
                dates: ['May 05', 'May 10', 'May 15', 'May 20', 'May 25', 'May 30'],
                impressions: [1200, 2400, 5800, 3100, 4100, 1600],
                followers: [4278, 4284, 4292, 4305, 4312, 4320]
            },
            topPosts: [
                { text: 'The average B2B sales cycle has expanded by 35% this year. Why? Too many decision makers and lack of upfront qualification.', type: 'text', impressions: 8500, reactions: 72, comments: 16, shares: 5, date: '2026-05-15' },
                { text: 'A checklist of outbound email templates that actually got replies in Q2. Save this graphic for your sales team.', type: 'image', impressions: 6400, reactions: 48, comments: 11, shares: 2, date: '2026-05-25' }
            ]
        }
    ];
}

// ==========================================================================
function updateAuthUI(isLoggedIn) {}
async function loginWithGoogle() {}
async function logout() {}
function toggleUserDropdown() {}
function populateCollaboratorsList(client) {}
async function addCollaborator() {}
async function removeCollaborator(email) {}
async function importLocalClientsToCloud() {}

// ==========================================================================
// MONTHLY REPORT PERIOD HANDLERS
// ==========================================================================
function toggleWizardPeriodType() {
    const type = document.getElementById('input-reporting-period-type').value;
    const monthlyGroup = document.getElementById('wizard-monthly-picker-group');
    if (monthlyGroup) {
        monthlyGroup.style.display = type === 'monthly' ? 'block' : 'none';
    }
}

function toggleEditPeriodType() {
    const type = document.getElementById('edit-reporting-period-type').value;
    const rangeGroup = document.getElementById('edit-date-range-group');
    const monthlyGroup = document.getElementById('edit-monthly-picker-group');
    if (type === 'monthly') {
        if (rangeGroup) rangeGroup.style.display = 'none';
        if (monthlyGroup) monthlyGroup.style.display = 'block';
    } else {
        if (rangeGroup) rangeGroup.style.display = 'block';
        if (monthlyGroup) monthlyGroup.style.display = 'none';
    }
}

function formatMonthString(monthVal) {
    if (!monthVal) return '';
    const [year, month] = monthVal.split('-');
    const date = new Date(year, parseInt(month) - 1, 1);
    return date.toLocaleDateString('en-US', { month: 'long', year: 'numeric' });
}
async function deleteActiveReport() {
    if (!appState.activeClientId) return;
    await deleteClient(appState.activeClientId);
}

// ==========================================================================
// BIND GLOBAL ATTRIBUTES FOR ES MODULE EXPORTS
// ==========================================================================
window.switchView = switchView;
window.toggleTheme = toggleTheme;
window.selectClient = selectClient;
window.deleteClient = deleteClient;
window.deleteActiveReport = deleteActiveReport;
window.validateStep1 = validateStep1;
window.validateStep2 = validateStep2;
window.saveWizardClient = saveWizardClient;
window.openShareModal = openShareModal;
window.copyShareLink = copyShareLink;
window.printReport = printReport;
window.openCreateClientModal = openCreateClientModal;
window.createClientFromModal = createClientFromModal;
window.closeModal = closeModal;
window.openEditClientModal = openEditClientModal;
window.saveEditClient = saveEditClient;
window.switchEditTab = switchEditTab;
window.handleEditFileSelect = handleEditFileSelect;
window.applyReuploadedFiles = applyReuploadedFiles;
window.showTutorial = showTutorial;
window.toggleWizardPeriodType = toggleWizardPeriodType;
window.toggleEditPeriodType = toggleEditPeriodType;
window.loginWithGoogle = loginWithGoogle;
window.logout = logout;
window.toggleUserDropdown = toggleUserDropdown;
window.addCollaborator = addCollaborator;
window.removeCollaborator = removeCollaborator;
window.importLocalClientsToCloud = importLocalClientsToCloud;
window.handleFileSelect = handleFileSelect;
