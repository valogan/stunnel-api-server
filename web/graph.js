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

    function drawGraph(agents, tunnels, liveTunnels = []) {
        const nodesData = new Map();
        const edgesData = [];
        currentNodesMap.clear();

        // 1. Add all Agents as nodes
        agents.forEach(a => {
            // Handle both agent_id/region_id and agent/region field names
            const agentId = a.agent_id || a.agent;
            const regionId = a.region_id || a.region;
            currentNodesMap.set(agentId, { region: regionId, agent: agentId });
            nodesData.set(agentId, {
                id: agentId,
                label: agentId,
                group: regionId
            });
        });

        // Assign colors and widths based on metrics
        const getEdgeStyle = (metrics) => {
            if (!metrics || metrics.health === 'unknown') return { color: { color: '#3b82f6', highlight: '#60a5fa' }, width: 1 }; // Blue
            if (metrics.health === 'degraded') return { color: { color: '#ef4444', highlight: '#f87171' }, width: 2 }; // Red

            // If healthy, check throughput
            let bytesPerSec = 0;
            if (metrics.bytes_msg && metrics.bytes_msg.includes('B/s')) {
                bytesPerSec = parseInt(metrics.bytes_msg.replace(/,/g, '').split(' ')[0]) || 0;
            }

            if (bytesPerSec < 1000) {
                return { color: { color: '#9ca3af', highlight: '#d1d5db', opacity: 0.6 }, width: 1 }; // Gray (idle/low bandwidth), thinner
            } else {
                return { color: { color: '#22c55e', highlight: '#4ade80', opacity: 1.0 }, width: 3 }; // Green (active traffic), thicker
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

            const edgeStyle = getEdgeStyle(t.metrics);

            // Edge
            edgesData.push({
                id: t.stunnel_id,
                from: t.src_agent,
                to: t.dst_agent,
                label: `${t.src_port} \u2192 ${t.dst_port}`,
                title: tooltip,
                stunnel_id: t.stunnel_id,
                arrows: 'to',
                color: edgeStyle.color,
                width: edgeStyle.width,
                font: { color: '#94a3b8', strokeWidth: 0, align: 'horizontal' },
                metrics_health: t.metrics ? t.metrics.health : "unknown",
                smooth: { type: 'dynamic' }, // Allow multiple edges to curve dynamically without overlapping
                // Store tunnel info for deletion
                src_region: t.src_region,
                src_agent: t.src_agent,
                src_plugin: t.src_plugin || t.stunnel_plugin_id,
                dst_region: t.dst_region,
                dst_agent: t.dst_agent,
                dst_plugin: t.dst_plugin
            });
        });

        // 3. Add Live Tunnels from Cresco stunnel plugins as additional edges
        if (liveTunnels && liveTunnels.length > 0) {
            console.log(`Processing ${liveTunnels.length} live tunnels`);
            liveTunnels.forEach(lt => {
                if (!lt || typeof lt !== 'object') return;
                
                // Extract tunnel info - structure depends on stunnel plugin response
                const tunnelId = lt.stunnel_id || lt.id || lt.tunnel_id;
                const srcPort = lt.src_port || lt.source_port || lt.local_port || '';
                const dstPort = lt.dst_port || lt.dest_port || lt.remote_port || '';
                const dstHost = lt.dst_host || lt.dest_host || lt.remote_host || '';
                
                // Get source agent info from the config (src_agent is the actual source)
                // Fall back to _src_agent if src_agent not in config
                const srcAgent = lt.src_agent || lt._src_agent;
                const srcRegion = lt.src_region || lt._src_region;
                
                // For destination, try to extract from tunnel config or use placeholder
                let dstAgent = lt.dst_agent || lt.dest_agent || '';
                let dstRegion = lt.dst_region || lt.dest_region || srcRegion;
                
                if (!tunnelId || !srcAgent) {
                    console.log('Skipping tunnel - missing tunnelId or srcAgent:', lt);
                    return; // Skip if we don't have essential info
                }
                
                // If we don't have destination agent, create a placeholder based on dst_host
                // If no dst_host either, use a generic "unknown-destination" placeholder
                if (!dstAgent) {
                    dstAgent = dstHost || `dest-${tunnelId.substring(0, 8)}`;
                    dstRegion = dstRegion || srcRegion;
                    console.log(`Created placeholder destination for tunnel ${tunnelId}: ${dstAgent}`);
                }
                
                // Add source node if not exists
                if (!nodesData.has(srcAgent)) {
                    currentNodesMap.set(srcAgent, { region: srcRegion, agent: srcAgent });
                    nodesData.set(srcAgent, {
                        id: srcAgent, label: srcAgent, group: srcRegion
                    });
                }
                
                // Add destination node if not exists
                if (!nodesData.has(dstAgent)) {
                    currentNodesMap.set(dstAgent, { region: dstRegion, agent: dstAgent });
                    nodesData.set(dstAgent, {
                        id: dstAgent, label: dstAgent, group: dstRegion
                    });
                }
                
                // Check if this edge already exists from database tunnels
                const existingEdge = edgesData.find(e => e.id === tunnelId);
                if (existingEdge) {
                    // Update existing edge with live info
                    existingEdge.is_live = true;
                    return;
                }
                
                // Create edge for live tunnel not in database - use same styling as database tunnels
                const label = srcPort && dstPort ? `${srcPort} → ${dstPort}` : tunnelId.substring(0, 8);
                const tooltip = `Tunnel ID: ${tunnelId}\nSrc: ${srcAgent}:${srcPort || 'N/A'}\nDst: ${dstHost || dstAgent}:${dstPort || 'N/A'}\nStatus: ${lt.status || 'active'}`;
                
                // Use the same edge style function as database tunnels
                const edgeStyle = getEdgeStyle({ health: 'unknown' });
                
                edgesData.push({
                    id: tunnelId,
                    from: srcAgent,
                    to: dstAgent,
                    label: label,
                    title: tooltip,
                    stunnel_id: tunnelId,
                    arrows: 'to',
                    color: edgeStyle.color,
                    width: edgeStyle.width,
                    font: { color: '#94a3b8', strokeWidth: 0, align: 'horizontal' },
                    metrics_health: 'unknown',
                    is_live: true,
                    smooth: { type: 'dynamic' },
                    // Store tunnel info for deletion
                    src_region: srcRegion,
                    src_agent: srcAgent,
                    src_plugin: lt.src_plugin,
                    dst_region: dstRegion,
                    dst_agent: dstAgent,
                    dst_plugin: lt.dst_plugin
                });
            });
        }

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
                            await deleteTunnelFromGraph(
                                edge.stunnel_id,
                                edge.src_region,
                                edge.src_agent,
                                edge.src_plugin,
                                edge.dst_region,
                                edge.dst_agent,
                                edge.dst_plugin
                            );
                        }
                    }
                }
            });
            initialized = true;
        }
    }

    async function deleteTunnelFromGraph(tunnelId, srcRegion, srcAgent, srcPlugin, dstRegion, dstAgent, dstPlugin) {
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

    // Keep track of the latest agents so the WebSocket can just update tunnels
    let currentAgents = [];

    async function fetchAgents() {
        try {
            const agentsRes = await fetch(`${API_URL}/agents`);
            if (agentsRes.ok) {
                const agentsData = await agentsRes.json();
                currentAgents = agentsData.agents || [];
            }
        } catch (error) {
            console.error('Error fetching agents:', error);
        }
    }

    // Set up WebSocket for realtime tunnel metrics and live agents
    let ws = null;
    function connectWebSocket() {
        if (ws) {
            ws.close();
        }
        
        const wsProtocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrlStr = API_URL.replace(/^https?:\/\//, '');
        const wsUrl = `${wsProtocol}//${wsUrlStr}/ws/tunnels`;

        console.log("Connecting to WebSocket:", wsUrl);
        ws = new WebSocket(wsUrl);

        ws.onopen = () => {
            console.log("WebSocket connected!");
        };

        ws.onmessage = (event) => {
            try {
                const data = JSON.parse(event.data);
                // Use database tunnels as base
                let tunnels = data.database_tunnels || [];
                // Also include live tunnels from Cresco if available
                const liveTunnels = data.live_tunnels || [];
                
                // Use live agents from WebSocket if available, otherwise fall back to cached
                const agents = data.agents || currentAgents;
                if (agents && agents.length > 0) {
                    currentAgents = agents; // Update cache
                    drawGraph(agents, tunnels, liveTunnels);
                } else if (currentAgents.length > 0) {
                    drawGraph(currentAgents, tunnels, liveTunnels);
                }
            } catch (err) {
                console.error("Error parsing WS message", err);
            }
        };

        ws.onclose = () => {
            console.log("WebSocket disconnected. Retrying in 5 seconds...");
            setTimeout(connectWebSocket, 5000);
        };

        ws.onerror = (err) => {
            console.error("WebSocket error:", err);
            ws.close();
        };
    }

    // Replace original refresh button action
    refreshBtn.addEventListener('click', async () => {
        await fetchAgents();
        // The WS will automatically paint the next tick, but to be instant we could force a pull
        console.log("Force refreshed Agents list.");
    });

    // Initial Bootstrap
    async function init() {
        await fetchAgents();
        connectWebSocket();
    }
    
    init();
});
