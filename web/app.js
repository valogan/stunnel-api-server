document.addEventListener('DOMContentLoaded', () => {
    // Determine default API URL
    const defaultApiUrl = `/api`;
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
    const proxyShieldForm = document.getElementById('proxyShieldForm');
    const proxyShieldSubmitBtn = document.getElementById('proxyShieldSubmitBtn');
    const proxyShieldMessage = document.getElementById('proxyShieldMessage');
    const proxyAgentSelect = document.getElementById('proxy_agent_select');
    const proxyShieldRefreshAgentsBtn = document.getElementById('proxyShieldRefreshAgentsBtn');

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
            buffer_size: document.getElementById('buffer_size').value || "1024",
            stunnel_plugin_id: document.getElementById('stunnel_plugin_id').value
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

    async function loadAgentsForProxyShield() {
        if (!proxyAgentSelect) return;

        proxyAgentSelect.innerHTML = '<option value="">Loading agents...</option>';
        try {
            const response = await fetch(`${API_URL}/agents`);
            if (!response.ok) {
                throw new Error('Failed to load agents');
            }

            const data = await response.json();
            const agents = Array.isArray(data.agents) ? data.agents : [];

            if (agents.length === 0) {
                proxyAgentSelect.innerHTML = '<option value="">No agents available</option>';
                return;
            }

            proxyAgentSelect.innerHTML = '<option value="">Select target agent</option>';
            agents.forEach((agent) => {
                const region = agent.region || agent.region_id || '';
                const agentId = agent.agent || agent.agent_id || '';
                if (!region || !agentId) return;

                const option = document.createElement('option');
                option.value = `${region}::${agentId}`;
                option.textContent = `${region} / ${agentId}`;
                proxyAgentSelect.appendChild(option);
            });
        } catch (error) {
            console.error('Error loading agents:', error);
            proxyAgentSelect.innerHTML = '<option value="">Failed to load agents</option>';
        }
    }

    if (proxyShieldRefreshAgentsBtn) {
        proxyShieldRefreshAgentsBtn.addEventListener('click', () => {
            loadAgentsForProxyShield();
        });
    }

    if (proxyShieldForm) {
        proxyShieldForm.addEventListener('submit', async (e) => {
            e.preventDefault();

            proxyShieldMessage.className = 'message hidden';

            const selection = proxyAgentSelect.value || '';
            if (!selection.includes('::')) {
                proxyShieldMessage.textContent = 'Please select a target agent.';
                proxyShieldMessage.className = 'message error';
                return;
            }

            const [target_region, target_agent] = selection.split('::');
            const payload = {
                target_region,
                target_agent,
                target_host: document.getElementById('proxy_target_host').value,
                jar_url: document.getElementById('proxy_jar_url').value,
            };

            proxyShieldSubmitBtn.disabled = true;
            proxyShieldSubmitBtn.querySelector('.loader').classList.remove('hidden');

            try {
                const response = await fetch(`${API_URL}/proxy-shield/deploy-and-configure`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    body: JSON.stringify(payload),
                });

                const data = await response.json();
                if (!response.ok) {
                    const detail = typeof data.detail === 'string' ? data.detail : JSON.stringify(data.detail || data);
                    throw new Error(detail || 'Failed to deploy and configure proxy shield');
                }

                const details = data.data || {};
                proxyShieldMessage.textContent = `Success! Pipeline: ${details.pipeline_id || 'N/A'} Plugin: ${details.plugin_id || 'N/A'}`;
                proxyShieldMessage.className = 'message success';
            } catch (error) {
                console.error('Error deploying proxy shield:', error);
                proxyShieldMessage.textContent = `Error: ${error.message}`;
                proxyShieldMessage.className = 'message error';
            } finally {
                proxyShieldSubmitBtn.disabled = false;
                proxyShieldSubmitBtn.querySelector('.loader').classList.add('hidden');
            }
        });
    }

    // Fetch and Display Tunnels
    // Fetch and Display Tunnels (Live from Cresco)
    async function fetchTunnels() {
        const tbody = document.getElementById('tunnelsBody');

        try {
            // Use include_agents=true to get live tunnels from Cresco stunnel plugins
            const response = await fetch(`${API_URL}/tunnels?include_agents=true`);
            if (!response.ok) {
                throw new Error('Failed to fetch tunnels');
            }

            const data = await response.json();
            // Use live_tunnels from Cresco instead of database_tunnels
            const tunnels = data.live_tunnels || [];

            if (tunnels.length === 0) {
                tbody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No live tunnels found.</td></tr>`;
                return;
            }

            tbody.innerHTML = '';
            tunnels.forEach(t => {
                const tr = document.createElement('tr');

                // Truncate IDs for display
                const shortId = t.stunnel_id ? t.stunnel_id.substring(0, 8) + '...' : 'N/A';

                // Handle stunnel_plugin_id truncation - use src_plugin from live tunnels
                const rawPluginId = t.src_plugin || t._src_plugin_id || t.stunnel_plugin_id || 'N/A';
                const shortPluginId = rawPluginId.length > 15 ? rawPluginId.substring(0, 15) + '...' : rawPluginId;

                // Format Source and Destination - live tunnels use src_agent/_src_agent fields
                const srcAgent = t.src_agent || t._src_agent || 'N/A';
                const srcRegion = t.src_region || t._src_region || 'N/A';
                const srcPort = t.src_port || t.local_port || 'N/A';
                const dstAgent = t.dst_agent || t.dest_agent || 'N/A';
                const dstRegion = t.dst_region || t.dest_region || srcRegion;
                const dstHost = t.dst_host || t.dest_host || t.remote_host || 'N/A';
                const dstPort = t.dst_port || t.dest_port || t.remote_port || 'N/A';
                
                const source = `${srcAgent} (${srcRegion}) :${srcPort}`;
                const dest = `${dstAgent} (${dstRegion}) -> ${dstHost}:${dstPort}`;

                // Live tunnels are active by definition (they're running)
                let statusBadge = `<span class="status status-running">Active</span>`;

                tr.innerHTML = `
                    <td title="${t.stunnel_id}">${shortId}</td>
                    <td title="${rawPluginId}">${shortPluginId}</td>
                    <td>${source}</td>
                    <td>${dest}</td>
                    <td>${t.buffer_size || 'N/A'}</td>
                    <td id="status-${t.stunnel_id}">${statusBadge}</td>
                    <td>
                        <div style="display: flex; gap: 5px;">
                            <button class="btn btn-secondary btn-sm status-btn" data-id="${t.stunnel_id}" data-region="${srcRegion}" data-agent="${srcAgent}" data-plugin="${rawPluginId}">Status</button>
                            <button class="btn btn-secondary btn-sm config-btn" data-id="${t.stunnel_id}" data-region="${srcRegion}" data-agent="${srcAgent}" data-plugin="${rawPluginId}">Config</button>
                            <button class="btn btn-danger btn-sm delete-btn" data-id="${t.stunnel_id}" data-src-region="${srcRegion}" data-src-agent="${srcAgent}" data-src-plugin="${rawPluginId}" data-dst-region="${dstRegion}" data-dst-agent="${dstAgent}" data-dst-plugin="${t.dst_plugin || ''}">Delete</button>
                        </div>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // Attach event listeners for delete buttons
            document.querySelectorAll('.delete-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const tunnelId = e.target.getAttribute('data-id');
                    const srcRegion = e.target.getAttribute('data-src-region');
                    const srcAgent = e.target.getAttribute('data-src-agent');
                    const srcPlugin = e.target.getAttribute('data-src-plugin');
                    const dstRegion = e.target.getAttribute('data-dst-region');
                    const dstAgent = e.target.getAttribute('data-dst-agent');
                    const dstPlugin = e.target.getAttribute('data-dst-plugin');
                    
                    if (confirm(`Are you sure you want to delete tunnel ${tunnelId}?`)) {
                        await deleteTunnel(tunnelId, srcRegion, srcAgent, srcPlugin, dstRegion, dstAgent, dstPlugin);
                    }
                });
            });

            // Info Modal Elements
            const infoModal = document.getElementById('infoModal');
            const infoModalTitle = document.getElementById('infoModalTitle');
            const infoModalBody = document.getElementById('infoModalBody');
            const closeInfoModalBtn = document.getElementById('closeInfoModalBtn');

            closeInfoModalBtn.addEventListener('click', () => {
                infoModal.classList.add('hidden');
            });

            infoModal.addEventListener('click', (e) => {
                if (e.target === infoModal) {
                    infoModal.classList.add('hidden');
                }
            });

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
            // Changed colspan to 7 here as well
            tbody.innerHTML = `<tr><td colspan="7" class="text-center text-danger">Failed to load tunnels. Ensure API is reachable at ${API_URL}.</td></tr>`;
        }
    }


    // Function to delete a tunnel
    async function deleteTunnel(tunnelId, srcRegion, srcAgent, srcPlugin, dstRegion, dstAgent, dstPlugin) {
        try {
            // Build query string with optional parameters
            const params = new URLSearchParams();
            if (srcRegion) params.append('src_region', srcRegion);
            if (srcAgent) params.append('src_agent', srcAgent);
            if (srcPlugin) params.append('src_plugin', srcPlugin);
            if (dstRegion) params.append('dst_region', dstRegion);
            if (dstAgent) params.append('dst_agent', dstAgent);
            if (dstPlugin) params.append('dst_plugin', dstPlugin);
            
            const queryString = params.toString();
            const url = `${API_URL}/tunnels/${tunnelId}${queryString ? '?' + queryString : ''}`;
            
            const response = await fetch(url, {
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
    loadAgentsForProxyShield();
    fetchTunnels();
});
