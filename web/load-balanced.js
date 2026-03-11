document.addEventListener('DOMContentLoaded', () => {
    // Determine default API URL
    const defaultApiUrl = `/api`;
    let API_URL = localStorage.getItem('crescoApiUrl') || defaultApiUrl;

    // UI Elements
    const apiUrlInput = document.getElementById('apiUrl');
    const configModal = document.getElementById('configModal');
    const configToggle = document.getElementById('configToggle');
    const saveConfigBtn = document.getElementById('saveConfigBtn');

    if (apiUrlInput) apiUrlInput.value = API_URL;

    // Toggle Config Modal
    if (configToggle) {
        configToggle.addEventListener('click', () => {
            configModal.classList.remove('hidden');
        });
    }

    if (saveConfigBtn) {
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
    }

    // Close modal if clicking outside
    if (configModal) {
        configModal.addEventListener('click', (e) => {
            if (e.target === configModal) {
                configModal.classList.add('hidden');
            }
        });
    }

    // Dynamic Destinations Logic
    const destinationsContainer = document.getElementById('destinationsContainer');
    const addDstBtn = document.getElementById('addDstBtn');

    if (addDstBtn && destinationsContainer) {
        addDstBtn.addEventListener('click', () => {
            const row = document.createElement('div');
            row.className = 'destination-row';
            row.style = 'display:flex; gap:10px; margin-bottom:10px;';
            row.innerHTML = `
                <input type="text" class="dst-input" required placeholder="e.g., 127.0.0.1:8874" style="flex:1;">
                <button type="button" class="btn btn-secondary remove-dst-btn" style="padding:0 15px;">X</button>
            `;
            destinationsContainer.appendChild(row);
            updateRemoveButtons();
        });

        destinationsContainer.addEventListener('click', (e) => {
            if (e.target.classList.contains('remove-dst-btn')) {
                e.target.closest('.destination-row').remove();
                updateRemoveButtons();
            }
        });

        function updateRemoveButtons() {
            const rows = destinationsContainer.querySelectorAll('.destination-row');
            const btns = destinationsContainer.querySelectorAll('.remove-dst-btn');
            btns.forEach(btn => btn.disabled = rows.length === 1);
        }
    }

    // Handle Form Submission
    const createTunnelForm = document.getElementById('createTunnelForm');
    const submitBtn = document.getElementById('submitBtn');
    const formMessage = document.getElementById('formMessage');
    const refreshBtn = document.getElementById('refreshBtn');

    if (createTunnelForm) {
        createTunnelForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            // Hide previous messages
            formMessage.className = 'message hidden';

            const dstInputs = document.querySelectorAll('.dst-input');
            const destinations = Array.from(dstInputs).map(input => input.value.trim()).filter(val => val !== "");

            // Build payload for load-balanced endpoint
            const payload = {
                src_region: document.getElementById('src_region').value,
                src_agent: document.getElementById('src_agent').value,
                src_port: document.getElementById('src_port').value,
                dst_region: document.getElementById('dst_region').value,
                dst_agent: document.getElementById('dst_agent').value,
                destinations: destinations,
                buffer_size: document.getElementById('buffer_size').value || "1024",
            };

            // Loading state
            submitBtn.disabled = true;
            submitBtn.querySelector('.loader').classList.remove('hidden');

            try {
                const response = await fetch(`${API_URL}/tunnels-load-balanced`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(payload)
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(data.detail || 'Failed to create load-balanced tunnels');
                }

                // Success
                formMessage.innerHTML = `<strong>Success!</strong><br>Message: ${data.message}<br><br><pre style="text-align:left; font-size:12px; background:rgba(0,0,0,0.1); padding:10px; border-radius:4px;">${JSON.stringify(data.data, null, 2)}</pre>`;
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
    }

    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => {
            fetchTunnels();
        });
    }

    // Fetch and Display Tunnels
    async function fetchTunnels() {
        const tbody = document.getElementById('tunnelsBody');
        if (!tbody) return;

        try {
            const response = await fetch(`${API_URL}/tunnels`);
            if (!response.ok) {
                throw new Error('Failed to fetch tunnels');
            }

            const data = await response.json();
            const tunnels = data.database_tunnels || [];

            if (tunnels.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No tunnels found.</td></tr>`;
                return;
            }

            tbody.innerHTML = '';
            tunnels.forEach(t => {
                const tr = document.createElement('tr');

                // Truncate IDs for display
                const shortId = t.stunnel_id ? t.stunnel_id.substring(0, 8) + '...' : 'N/A';

                // Handle stunnel_plugin_id truncation
                const rawPluginId = t.stunnel_plugin_id || 'N/A';
                const shortPluginId = rawPluginId.length > 15 ? rawPluginId.substring(0, 15) + '...' : rawPluginId;

                // Format Source and Destination
                const source = `${t.src_agent} (${t.src_region}) :${t.src_port}`;
                const dest = `${t.dst_agent} (${t.dst_region}) -> ${t.dst_host}:${t.dst_port}`;

                // Read live status if we fetched it (only available if live_cresco_tunnels matched)
                let statusBadge = `<span class="status status-running">Active (DB)</span>`;

                if (data.live_cresco_tunnels && data.live_cresco_tunnels.length > 0) {
                    const liveTunnel = data.live_cresco_tunnels.find(lt => lt.stunnel_id === t.stunnel_id);
                    if (liveTunnel) {
                        statusBadge = `<span class="status status-running">Active (Live)</span>`;
                    } else {
                        statusBadge = `<span class="status" style="background-color:#4a5568;">Inactive (Live)</span>`;
                    }
                }

                tr.innerHTML = `
                    <td title="${t.stunnel_id}">${shortId}</td>
                    <td title="${rawPluginId}">${shortPluginId}</td>
                    <td>${source}</td>
                    <td>${dest}</td>
                    <td>${t.buffer_size}</td>
                    <td id="status-${t.stunnel_id}">${statusBadge}</td>
                    <td>
                        <div style="display: flex; gap: 5px;">
                            <button class="btn btn-secondary btn-sm status-btn" data-id="${t.stunnel_id}" data-region="${t.src_region}" data-agent="${t.src_agent}" data-plugin="${t.stunnel_plugin_id}">Status</button>
                            <button class="btn btn-secondary btn-sm config-btn" data-id="${t.stunnel_id}" data-region="${t.src_region}" data-agent="${t.src_agent}" data-plugin="${t.stunnel_plugin_id}">Config</button>
                            <button class="btn btn-danger btn-sm delete-btn" data-id="${t.stunnel_id}">Delete</button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);

                // Check live runtime status if active plugin
                if (t.stunnel_plugin_id && t.stunnel_plugin_id !== 'null') {
                    fetch(`${API_URL}/tunnels/${t.stunnel_id}/status?src_region=${t.src_region}&src_agent=${t.src_agent}&src_plugin_id=${t.stunnel_plugin_id}`)
                        .then(res => {
                            if (!res.ok) throw new Error('Status fetch failed');
                            return res.json();
                        })
                        .then(statusData => {
                            const statusCell = document.getElementById(`status-${t.stunnel_id}`);
                            if (statusCell) {
                                if (statusData.status === 'pluginActive') {
                                    statusCell.innerHTML = `<span class="status status-running">Online</span>`;
                                } else {
                                    statusCell.innerHTML = `<span class="status" style="background-color:#4a5568;">Offline</span>`;
                                }
                            }
                        })
                        .catch(err => {
                            const statusCell = document.getElementById(`status-${t.stunnel_id}`);
                            if (statusCell) {
                                statusCell.innerHTML = `<span class="status" style="background-color:#4a5568;">Offline</span>`;
                            }
                        });
                }
            });

            // Attach event listeners for delete buttons
            document.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const tunnelId = e.target.getAttribute('data-id');
                    if (confirm(`Are you sure you want to delete tunnel ${tunnelId}?`)) {
                        await deleteTunnel(tunnelId);
                    }
                });
            });

            // Info Modal Elements
            const infoModal = document.getElementById('infoModal');
            const infoModalTitle = document.getElementById('infoModalTitle');
            const infoModalBody = document.getElementById('infoModalBody');
            const closeInfoModalBtn = document.getElementById('closeInfoModalBtn');

            if (closeInfoModalBtn) {
                closeInfoModalBtn.addEventListener('click', () => {
                    infoModal.classList.add('hidden');
                });
            }

            if (infoModal) {
                infoModal.addEventListener('click', (e) => {
                    if (e.target === infoModal) {
                        infoModal.classList.add('hidden');
                    }
                });
            }

            // Attach event listeners for status buttons
            document.querySelectorAll('.status-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const tunnelId = e.target.getAttribute('data-id');
                    const region = e.target.getAttribute('data-region');
                    const agent = e.target.getAttribute('data-agent');
                    const plugin = e.target.getAttribute('data-plugin');
                    
                    if (!plugin || plugin === 'null') {
                        alert("Plugin ID is required to fetch status");
                        return;
                    }

                    try {
                        const response = await fetch(`${API_URL}/tunnels/${tunnelId}/status?src_region=${region}&src_agent=${agent}&src_plugin_id=${plugin}`);
                        if (!response.ok) throw new Error('Failed to fetch status');
                        const data = await response.json();
                        
                        infoModalTitle.textContent = `Status: ${tunnelId}`;
                        infoModalBody.textContent = JSON.stringify(data.status, null, 2);
                        infoModal.classList.remove('hidden');
                    } catch (error) {
                        alert(`Error fetching status: ${error.message}`);
                    }
                });
            });

            // Attach event listeners for config buttons
            document.querySelectorAll('.config-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const tunnelId = e.target.getAttribute('data-id');
                    const region = e.target.getAttribute('data-region');
                    const agent = e.target.getAttribute('data-agent');
                    const plugin = e.target.getAttribute('data-plugin');
                    
                    if (!plugin || plugin === 'null') {
                        alert("Plugin ID is required to fetch config");
                        return;
                    }

                    try {
                        const response = await fetch(`${API_URL}/tunnels/${tunnelId}/config?src_region=${region}&src_agent=${agent}&src_plugin_id=${plugin}`);
                        if (!response.ok) throw new Error('Failed to fetch config');
                        const data = await response.json();
                        
                        infoModalTitle.textContent = `Config: ${tunnelId}`;
                        infoModalBody.textContent = JSON.stringify(data.config, null, 2);
                        infoModal.classList.remove('hidden');
                    } catch (error) {
                        alert(`Error fetching config: ${error.message}`);
                    }
                });
            });

        } catch (error) {
            console.error('Error fetching tunnels:', error);
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load tunnels. Ensure API is reachable at ${API_URL}.</td></tr>`;
        }
    }

    // Function to delete a tunnel
    async function deleteTunnel(tunnelId) {
        try {
            const response = await fetch(`${API_URL}/tunnels/${tunnelId}`, {
                method: 'DELETE',
            });
            
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to delete tunnel');
            }
            
            alert(`Tunnel ${tunnelId} deleted successfully.`);
            fetchTunnels(); // Refresh the list
        } catch (error) {
            console.error('Error deleting tunnel:', error);
            alert(`Error deleting tunnel: ${error.message}`);
        }
    }

    // Initial fetch
    fetchTunnels();
});
