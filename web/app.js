document.addEventListener('DOMContentLoaded', () => {
    // Determine default API URL
    const defaultApiUrl = `http://${window.location.hostname}:8000`;
    let API_URL = localStorage.getItem('crescoApiUrl') || defaultApiUrl;

    // UI Elements
    const apiUrlInput = document.getElementById('apiUrl');
    const configModal = document.getElementById('configModal');
    const configToggle = document.getElementById('configToggle');
    const saveConfigBtn = document.getElementById('saveConfigBtn');

    apiUrlInput.value = API_URL;

    // Toggle Config Modal
    configToggle.addEventListener('click', () => {
        configModal.classList.remove('hidden');
    });

    saveConfigBtn.addEventListener('click', () => {
        const newUrl = apiUrlInput.value.trim();
        if (newUrl) {
            // strip trailing slash
            API_URL = newUrl.replace(/\/$/, "");
            localStorage.setItem('crescoApiUrl', API_URL);
            configModal.classList.add('hidden');
            fetchTunnels();
        }
    });

    // Close modal if clicking outside
    configModal.addEventListener('click', (e) => {
        if (e.target === configModal) {
            configModal.classList.add('hidden');
        }
    });

    // Handle Form Submission
    const createTunnelForm = document.getElementById('createTunnelForm');
    const submitBtn = document.getElementById('submitBtn');
    const formMessage = document.getElementById('formMessage');
    const refreshBtn = document.getElementById('refreshBtn');

    createTunnelForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        // Hide previous messages
        formMessage.className = 'message hidden';

        // Build payload
        const payload = {
            src_region: document.getElementById('src_region').value,
            src_agent: document.getElementById('src_agent').value,
            src_port: document.getElementById('src_port').value,
            dst_region: document.getElementById('dst_region').value,
            dst_agent: document.getElementById('dst_agent').value,
            dst_host: document.getElementById('dst_host').value,
            dst_port: document.getElementById('dst_port').value,
            buffer_size: document.getElementById('buffer_size').value || "1024"
        };

        // Loading state
        submitBtn.disabled = true;
        submitBtn.querySelector('.loader').classList.remove('hidden');

        try {
            const response = await fetch(`${API_URL}/tunnels`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                },
                body: JSON.stringify(payload)
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Failed to create tunnel');
            }

            // Success
            formMessage.textContent = `Success! Tunnel ID: ${data.message}`;
            formMessage.className = 'message success';
            createTunnelForm.reset();

            // Refresh list
            fetchTunnels();
        } catch (error) {
            // Error
            console.error('Error creating tunnel:', error);
            formMessage.textContent = error.message;
            formMessage.className = 'message error';
        } finally {
            // Reset loading state
            submitBtn.disabled = false;
            submitBtn.querySelector('.loader').classList.add('hidden');
        }
    });

    refreshBtn.addEventListener('click', () => {
        fetchTunnels();
    });

    // Fetch and Display Tunnels
    async function fetchTunnels() {
        const tbody = document.getElementById('tunnelsBody');

        try {
            const response = await fetch(`${API_URL}/tunnels`);
            if (!response.ok) {
                throw new Error('Failed to fetch tunnels');
            }

            const data = await response.json();
            const tunnels = data.database_tunnels || [];

            if (tunnels.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No tunnels found.</td></tr>`;
                return;
            }

            tbody.innerHTML = '';
            tunnels.forEach(t => {
                const tr = document.createElement('tr');

                // Truncate ID for display
                const shortId = t.stunnel_id.substring(0, 8) + '...';

                // Format Source and Destination
                const source = `${t.src_agent} (${t.src_region}) :${t.src_port}`;
                const dest = `${t.dst_agent} (${t.dst_region}) -> ${t.dst_host}:${t.dst_port}`;

                // Status mapping (since the DB might not have live status unless we query the plugin)
                const statusBadge = `<span class="status status-running">Active (DB)</span>`;

                tr.innerHTML = `
                    <td title="${t.stunnel_id}">${shortId}</td>
                    <td>${source}</td>
                    <td>${dest}</td>
                    <td>${t.buffer_size}</td>
                    <td>${statusBadge}</td>
                `;
                tbody.appendChild(tr);
            });

        } catch (error) {
            console.error('Error fetching tunnels:', error);
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Failed to load tunnels. Ensure API is reachable at ${API_URL}.</td></tr>`;
        }
    }

    // Initial fetch
    fetchTunnels();
});
