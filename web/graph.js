document.addEventListener('DOMContentLoaded', () => {
    // Determine default API URL
    const defaultApiUrl = `http://${window.location.hostname}:8005`;
    let API_URL = localStorage.getItem('crescoApiUrl') || defaultApiUrl;

    // UI Elements
    const apiUrlInput = document.getElementById('apiUrl');
    const configModal = document.getElementById('configModal');
    const configToggle = document.getElementById('configToggle');
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const refreshBtn = document.getElementById('refreshBtn');

    apiUrlInput.value = API_URL;

    // Toggle Config Modal
    configToggle.addEventListener('click', () => {
        configModal.classList.remove('hidden');
    });

    saveConfigBtn.addEventListener('click', () => {
        const newUrl = apiUrlInput.value.trim();
        if (newUrl) {
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

    refreshBtn.addEventListener('click', () => {
        fetchTunnels();
    });

    // Vis.js Network instance
    let network = null;

    // Fetch and Display Tunnels in Graph
    async function fetchTunnels() {
        try {
            const response = await fetch(`${API_URL}/tunnels`);
            if (!response.ok) {
                throw new Error('Failed to fetch tunnels');
            }

            const data = await response.json();
            const tunnels = data.database_tunnels || [];

            drawGraph(tunnels);

        } catch (error) {
            console.error('Error fetching tunnels:', error);
        }
    }

    function drawGraph(tunnels) {
        const nodesData = new Map();
        const edgesData = [];

        tunnels.forEach(t => {
            // Source Node
            if (!nodesData.has(t.src_agent)) {
                nodesData.set(t.src_agent, {
                    id: t.src_agent,
                    label: t.src_agent,
                    group: t.src_region
                });
            }

            // Destination Node
            if (!nodesData.has(t.dst_agent)) {
                nodesData.set(t.dst_agent, {
                    id: t.dst_agent,
                    label: t.dst_agent,
                    group: t.dst_region || t.src_region
                });
            }

            // Edge
            edgesData.push({
                from: t.src_agent,
                to: t.dst_agent,
                label: `${t.src_port} \u2192 ${t.dst_port}`,
                title: `Tunnel ID: ${t.stunnel_id}\nBuffer: ${t.buffer_size}`,
                arrows: 'to',
                color: { color: '#3b82f6', highlight: '#60a5fa' },
                font: { color: '#94a3b8', strokeWidth: 0, align: 'horizontal' }
            });
        });

        const nodes = Array.from(nodesData.values()).map(node => {
            return {
                ...node,
                shape: 'dot',
                size: 20,
                font: { color: '#f8fafc', size: 14 },
                color: {
                    border: '#2563eb',
                    background: '#1e293b',
                    highlight: {
                        border: '#60a5fa',
                        background: '#334155'
                    }
                }
            };
        });

        const container = document.getElementById('mynetwork');

        const data = {
            nodes: new vis.DataSet(nodes),
            edges: new vis.DataSet(edgesData)
        };

        const options = {
            physics: {
                solver: 'forceAtlas2Based',
                forceAtlas2Based: {
                    gravitationalConstant: -50,
                    centralGravity: 0.01,
                    springLength: 200,
                    springConstant: 0.08
                },
                maxVelocity: 50,
                timestep: 0.35,
                stabilization: { iterations: 150 }
            },
            interaction: {
                hover: true,
                tooltipDelay: 200
            }
        };

        if (network !== null) {
            network.destroy();
            network = null;
        }

        network = new vis.Network(container, data, options);
    }

    // Initial fetch
    fetchTunnels();
});
