document.addEventListener('DOMContentLoaded', () => {
    // Determine default API URL
    const defaultApiUrl = `/api`;
    let API_URL = localStorage.getItem('crescoApiUrl') || defaultApiUrl;

    // UI Elements
    const apiUrlInput = document.getElementById('apiUrl');
    const configModal = document.getElementById('configModal');
    const configToggle = document.getElementById('configToggle');
    const saveConfigBtn = document.getElementById('saveConfigBtn');

    if(apiUrlInput) apiUrlInput.value = API_URL;

    // Toggle Config Modal
    if(configToggle) {
        configToggle.addEventListener('click', () => {
            configModal.classList.remove('hidden');
        });
    }

    if(saveConfigBtn) {
        saveConfigBtn.addEventListener('click', () => {
            const newUrl = apiUrlInput.value.trim();
            if (newUrl) {
                API_URL = newUrl.replace(/\/$/, "");
                localStorage.setItem('crescoApiUrl', API_URL);
                configModal.classList.add('hidden');
                fetchAgents();
            }
        });
    }

    if(configModal) {
        configModal.addEventListener('click', (e) => {
            if (e.target === configModal) {
                configModal.classList.add('hidden');
            }
        });
    }

    const refreshAgentsBtn = document.getElementById('refreshAgentsBtn');
    if (refreshAgentsBtn) {
        refreshAgentsBtn.addEventListener('click', () => {
            fetchAgents();
        });
    }

    // Fetch and Display Agents
    async function fetchAgents() {
        const tbody = document.getElementById('agentsBody');
        if (!tbody) return;

        try {
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">Loading agents...</td></tr>`;
            const response = await fetch(`${API_URL}/agents`);
            const data = await response.json();

            if (!response.ok) {
                throw new Error(data.detail || 'Failed to fetch agents');
            }

            tbody.innerHTML = '';
            
            if (!data.agents || data.agents.length === 0) {
                tbody.innerHTML = `<tr><td colspan="5" class="text-center text-muted">No agents found</td></tr>`;
                return;
            }

            data.agents.forEach(agent => {
                const tr = document.createElement('tr');
                
                // Parse status description
                let statusLabel = `<span class="status" style="background-color:#4a5568;">Unknown</span>`;
                if (agent.status_desc) {
                    try {
                        const parsedStatus = JSON.parse(agent.status_desc);
                        if (parsedStatus.mode === 'GLOBAL') {
                             statusLabel = `<span class="status status-running">Global Controller</span>`;
                        } else {
                             statusLabel = `<span class="status status-running">Online</span>`;
                        }
                    } catch (e) {
                         statusLabel = `<span class="status" style="background-color:#4a5568;">Offline</span>`;
                    }
                }

                tr.innerHTML = `
                    <td>${agent.region_id}</td>
                    <td>${agent.agent_id}</td>
                    <td>${statusLabel}</td>
                    <td>${agent.environment || 'N/A'}</td>
                    <td>
                        <button class="btn btn-secondary btn-sm restart-btn" data-region="${agent.region_id}" data-agent="${agent.agent_id}">Restart</button>
                        <button class="btn btn-danger btn-sm stop-btn" data-region="${agent.region_id}" data-agent="${agent.agent_id}">Stop</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });

            // Attach event listeners for restart buttons
            document.querySelectorAll('.restart-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const region = e.target.getAttribute('data-region');
                    const agent = e.target.getAttribute('data-agent');
                    if (confirm(`Are you sure you want to restart agent ${region}/${agent}?`)) {
                        await restartAgent(region, agent);
                    }
                });
            });

            // Attach event listeners for stop buttons
            document.querySelectorAll('.stop-btn').forEach(btn => {
                btn.addEventListener('click', async (e) => {
                    const region = e.target.getAttribute('data-region');
                    const agent = e.target.getAttribute('data-agent');
                    if (confirm(`Are you sure you want to stop agent ${region}/${agent}? This action may disconnect tunnels passing through it.`)) {
                        await stopAgent(region, agent);
                    }
                });
            });

        } catch (error) {
            console.error('Error fetching agents:', error);
            tbody.innerHTML = `<tr><td colspan="5" class="text-center text-danger">Failed to load agents. Ensure API is reachable at ${API_URL}.</td></tr>`;
        }
    }

    // Function to restart an agent
    async function restartAgent(region, agent) {
        try {
            const response = await fetch(`${API_URL}/agents/${region}/${agent}/restart`, {
                method: 'POST',
            });
            
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to restart agent');
            }
            
            alert(`Restart command sent to agent ${region}/${agent}.`);
            // Optionally fetch agents again after a slight delay
            setTimeout(fetchAgents, 2000); 
        } catch (error) {
            console.error('Error restarting agent:', error);
            alert(`Error restarting agent: ${error.message}`);
        }
    }

    // Function to stop an agent
    async function stopAgent(region, agent) {
        try {
            const response = await fetch(`${API_URL}/agents/${region}/${agent}/stop`, {
                method: 'POST',
            });
            
            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to stop agent');
            }
            
            alert(`Stop command sent to agent ${region}/${agent}.`);
            // Optionally fetch agents again after a slight delay
            setTimeout(fetchAgents, 2000); 
        } catch (error) {
            console.error('Error stopping agent:', error);
            alert(`Error stopping agent: ${error.message}`);
        }
    }

    fetchAgents();
});
