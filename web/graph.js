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

    // Vis.js Network instance
    let network = null;
    let nodesDataset = new vis.DataSet();
    let edgesDataset = new vis.DataSet();
    let initialized = false;
    let edgeCreationCallback = null;
    const edgeModal = document.getElementById('edgeModal');
    const saveEdgeBtn = document.getElementById('saveEdgeBtn');
    const cancelEdgeBtn = document.getElementById('cancelEdgeBtn');

    let currentNodesMap = new Map(); // Store full agent data

    // Fetch Agents and Tunnels
    async function fetchDataAndDraw() {
        try {
            // Fetch Agents
            const agentsRes = await fetch(`${API_URL}/agents`);
            if (!agentsRes.ok) throw new Error('Failed to fetch agents');
            const agentsData = await agentsRes.json();
            const agents = agentsData.agents || [];

            // Fetch Tunnels
            const tunnelsRes = await fetch(`${API_URL}/tunnels`);
            if (!tunnelsRes.ok) throw new Error('Failed to fetch tunnels');
            const tunnelsData = await tunnelsRes.json();
            const tunnels = tunnelsData.database_tunnels || [];

            drawGraph(agents, tunnels);

        } catch (error) {
            console.error('Error fetching data for graph:', error);
        }
    }

    function drawGraph(agents, tunnels) {
        const nodesData = new Map();
        const edgesData = [];
        currentNodesMap.clear();

        // 1. Add all Agents as nodes
        agents.forEach(a => {
            currentNodesMap.set(a.agent_id, { region: a.region_id, agent: a.agent_id });
            nodesData.set(a.agent_id, {
                id: a.agent_id,
                label: a.agent_id,
                group: a.region_id
            });
        });

        // Assign colors based on metrics
        const getEdgeColor = (metrics) => {
            if (!metrics || metrics.health === 'unknown') return { color: '#3b82f6', highlight: '#60a5fa' }; // Blue
            if (metrics.health === 'degraded') return { color: '#ef4444', highlight: '#f87171' }; // Red

            // If healthy, check throughput
            let bytesPerSec = 0;
            if (metrics.bytes_msg && metrics.bytes_msg.includes('B/s')) {
                bytesPerSec = parseInt(metrics.bytes_msg.replace(/,/g, '').split(' ')[0]) || 0;
            }

            if (bytesPerSec < 1000) {
                return { color: '#9ca3af', highlight: '#d1d5db' }; // Gray (idle/low bandwidth)
            } else {
                return { color: '#22c55e', highlight: '#4ade80' }; // Green (active traffic)
            }
        };

        // 2. Add Tunnels as edges (and missing nodes just in case)
        tunnels.forEach(t => {
            // Source Node
            if (!nodesData.has(t.src_agent)) {
                currentNodesMap.set(t.src_agent, { region: t.src_region, agent: t.src_agent });
                nodesData.set(t.src_agent, {
                    id: t.src_agent, label: t.src_agent, group: t.src_region
                });
            }

            // Destination Node
            if (!nodesData.has(t.dst_agent)) {
                let dRegion = t.dst_region || t.src_region;
                currentNodesMap.set(t.dst_agent, { region: dRegion, agent: t.dst_agent });
                nodesData.set(t.dst_agent, {
                    id: t.dst_agent, label: t.dst_agent, group: dRegion
                });
            }

            let tooltip = `Tunnel ID: ${t.stunnel_id}\nBuffer: ${t.buffer_size}`;
            if (t.metrics) {
                if (t.metrics.bytes_msg) tooltip += `\nThroughput: ${t.metrics.bytes_msg}`;
                if (t.metrics.health) tooltip += `\nHealth: ${t.metrics.health.toUpperCase()}`;
            }

            // Edge
            edgesData.push({
                id: t.stunnel_id,
                from: t.src_agent,
                to: t.dst_agent,
                label: `${t.src_port} \u2192 ${t.dst_port}`,
                title: tooltip,
                stunnel_id: t.stunnel_id,
                arrows: 'to',
                color: getEdgeColor(t.metrics),
                font: { color: '#94a3b8', strokeWidth: 0, align: 'horizontal' },
                metrics_health: t.metrics ? t.metrics.health : "unknown"
            });
        });

        const nodes = Array.from(nodesData.values()).map(node => ({
            ...node, shape: 'dot', size: 20, font: { color: '#f8fafc', size: 14 },
            color: { border: '#2563eb', background: '#1e293b', highlight: { border: '#60a5fa', background: '#334155' } }
        }));

        nodesDataset.update(nodes);
        edgesDataset.update(edgesData);

        // Remove old nodes/edges
        const currentNodesIds = new Set(nodes.map(n => n.id));
        const currentEdgesIds = new Set(edgesData.map(e => e.id));

        nodesDataset.forEach(n => { if (!currentNodesIds.has(n.id)) nodesDataset.remove(n.id); });
        edgesDataset.forEach(e => { if (!currentEdgesIds.has(e.id)) edgesDataset.remove(e.id); });

        if (!initialized) {
            const container = document.getElementById('mynetwork');
            const data = { nodes: nodesDataset, edges: edgesDataset };

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
                },
                manipulation: {
                    enabled: false,
                    addEdge: function (edgeData, callback) {
                        if (edgeData.from === edgeData.to) {
                            alert("Cannot connect an agent to itself.");
                            callback(null);
                            return;
                        }

                        // Show Modal
                        document.getElementById('edgeSrcPort').value = '';
                        document.getElementById('edgeDstPort').value = '';

                        edgeModal.classList.remove('hidden');
                        edgeCreationCallback = {
                            edgeData: edgeData,
                            callback: callback
                        };
                    }
                }
            };

            network = new vis.Network(container, data, options);

            // Auto-enter Add Edge mode when clicking a node
            network.on("selectNode", function (params) {
                network.addEdgeMode();
            });

            network.on("deselectNode", function (params) {
                network.disableEditMode();
            });

            // Handle edge clicks for deletion
            network.on("selectEdge", async function (params) {
                // Only trigger if an edge is clicked without a node being selected
                if (params.nodes.length === 0 && params.edges.length === 1) {
                    const edgeId = params.edges[0];
                    const edge = edgesDataset.get(edgeId);

                    if (edge && edge.stunnel_id) {
                        if (confirm(`Do you want to delete tunnel ${edge.stunnel_id}?`)) {
                            await deleteTunnelFromGraph(edge.stunnel_id);
                        }
                    }
                }
            });
            initialized = true;
        }
    }

    async function deleteTunnelFromGraph(tunnelId) {
        try {
            const response = await fetch(`${API_URL}/tunnels/${tunnelId}`, {
                method: 'DELETE',
            });

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to delete tunnel');
            }

            // Refresh graph entirely
            await fetchDataAndDraw();
        } catch (error) {
            console.error('Error deleting tunnel:', error);
            alert(`Error deleting tunnel: ${error.message}`);
        }
    }

    // Modal Button Handlers
    cancelEdgeBtn.addEventListener('click', () => {
        edgeModal.classList.add('hidden');
        if (edgeCreationCallback) {
            edgeCreationCallback.callback(null);
            edgeCreationCallback = null;
        }
    });

    saveEdgeBtn.addEventListener('click', async () => {
        if (!edgeCreationCallback) return;

        const srcPort = document.getElementById('edgeSrcPort').value;
        const dstPort = document.getElementById('edgeDstPort').value;
        const dstHost = document.getElementById('edgeDstHost').value || "127.0.0.1";
        const bufferSize = document.getElementById('edgeBufferSize').value || "1024";

        if (!srcPort || !dstPort || !dstHost) {
            alert("Please fill in all required fields.");
            return;
        }

        const edgeData = edgeCreationCallback.edgeData;

        const srcNode = currentNodesMap.get(edgeData.from);
        const dstNode = currentNodesMap.get(edgeData.to);

        const payload = {
            src_region: srcNode.region,
            src_agent: srcNode.agent,
            src_port: srcPort,
            dst_region: dstNode.region,
            dst_agent: dstNode.agent,
            dst_host: dstHost,
            dst_port: dstPort,
            buffer_size: bufferSize,
            stunnel_plugin_id: ""
        };

        saveEdgeBtn.disabled = true;
        saveEdgeBtn.textContent = "Creating...";

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

            edgeModal.classList.add('hidden');

            // Refresh graph entirely
            await fetchDataAndDraw();

            // Clear visual add edge state
            edgeCreationCallback.callback(null);
            edgeCreationCallback = null;

        } catch (error) {
            console.error('Error creating tunnel:', error);
            alert(`Error creating tunnel: ${error.message}`);
        } finally {
            saveEdgeBtn.disabled = false;
            saveEdgeBtn.textContent = "Create Tunnel";
        }
    });

    // Replace original refresh button action
    refreshBtn.addEventListener('click', () => {
        fetchDataAndDraw();
    });

    // Initial fetch
    fetchDataAndDraw();

    // Auto-poll metrics every 5 seconds
    setInterval(fetchDataAndDraw, 5000);
});
