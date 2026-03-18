document.addEventListener('DOMContentLoaded', () => {
    console.log('agent-discovery.js loaded');
    // Determine default API URL
    const defaultApiUrl = `http://${window.location.hostname}:8005`;
    let API_URL = localStorage.getItem('crescoApiUrl') || defaultApiUrl;

    // UI Elements
    const apiUrlInput = document.getElementById('apiUrl');
    const configModal = document.getElementById('configModal');
    const configToggle = document.getElementById('configToggle');
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const refreshBtn = document.getElementById('refreshBtn');
    const toggleViewBtn = document.getElementById('toggleViewBtn');
    const showTunnelsCheckbox = document.getElementById('showTunnels');
    const showAgentsWithoutStunnelCheckbox = document.getElementById('showAgentsWithoutStunnel');
    const showEdgeLabelsCheckbox = document.getElementById('showEdgeLabels');
    const togglePhysicsBtn = document.getElementById('togglePhysicsBtn');
    const relayoutBtn = document.getElementById('relayoutBtn');
    const addEdgeBtn = document.getElementById('addEdgeBtn');
    const agentSearchInput = document.getElementById('agentSearch');
    const statsContainer = document.getElementById('statsContainer');
    const agentList = document.getElementById('agentList');

    // Edge creation modal elements
    const edgeModal = document.getElementById('edgeModal');
    const saveEdgeBtn = document.getElementById('saveEdgeBtn');
    const cancelEdgeBtn = document.getElementById('cancelEdgeBtn');
    const edgeSrcPort = document.getElementById('edgeSrcPort');
    const edgeDstPort = document.getElementById('edgeDstPort');
    const edgeDstHost = document.getElementById('edgeDstHost');
    const edgeBufferSize = document.getElementById('edgeBufferSize');

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
                API_URL = newUrl.replace(/\/$/, "");
                localStorage.setItem('crescoApiUrl', API_URL);
                configModal.classList.add('hidden');
                fetchAgentDiscovery();
            }
        });
    }

    if (configModal) {
        configModal.addEventListener('click', (e) => {
            if (e.target === configModal) {
                configModal.classList.add('hidden');
            }
        });
    }

    // Vis.js Network instance
    let network = null;
    let nodesDataset = new vis.DataSet();
    let edgesDataset = new vis.DataSet();
    let currentView = 'graph'; // 'graph' or 'list'
    let agentsData = [];
    let physicsEnabled = true;
    let edgeCreationCallback = null;
    let currentNodesMap = new Map(); // Store mapping from nodeId to agent data
    let edgeModeActive = false; // Track whether we're in edge creation mode

    // Initialize network
    function initNetwork() {
        const container = document.getElementById('agentNetwork');
        if (!container) return;

        const options = {
            nodes: {
                shape: 'dot',
                size: 20,
                font: {
                    size: 12,
                    face: 'Inter',
                },
                borderWidth: 2,
            },
            edges: {
                width: 1.5,
                arrows: {
                    to: { enabled: true, scaleFactor: 0.6 }
                },
                smooth: {
                    enabled: true,
                    type: 'curvedCW',
                    roundness: 0.2
                },
                font: {
                    size: 10,
                    align: 'middle',
                    strokeWidth: 2,
                    strokeColor: '#ffffff'
                },
                color: {
                    color: '#8b5cf6',
                    highlight: '#7c3aed',
                    opacity: 0.8
                }
            },
            physics: {
                enabled: true,
                solver: 'forceAtlas2Based',
                forceAtlas2Based: {
                    gravitationalConstant: -200,
                    centralGravity: 0.01,
                    springLength: 300,
                    springConstant: 0.02,
                    damping: 0.6,
                    avoidOverlap: 1
                },
                stabilization: {
                    enabled: true,
                    iterations: 200,
                    updateInterval: 50,
                    onlyDynamicEdges: false,
                    fit: true
                }
            },
            interaction: {
                hover: true,
                tooltipDelay: 200,
                selectable: true
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
                    if (edgeSrcPort) edgeSrcPort.value = '';
                    if (edgeDstPort) edgeDstPort.value = '';
                    if (edgeDstHost) edgeDstHost.value = '';
                    if (edgeBufferSize) edgeBufferSize.value = '1024';

                    edgeModal.classList.remove('hidden');
                    edgeCreationCallback = {
                        edgeData: edgeData,
                        callback: callback
                    };
                }
            }
        };

        const data = {
            nodes: nodesDataset,
            edges: edgesDataset
        };

        network = new vis.Network(container, data, options);

        // Disable physics after stabilization to prevent rubberbanding
        network.on('stabilizationIterationsDone', function () {
            // After stabilization, disable physics so nodes stay where dragged
            network.setOptions({ physics: false });
        });

        // Add click event for nodes
        network.on('click', function (params) {
            console.log('Network click event:', params);
            // Only scroll to agent card if edge mode is NOT active
            if (!edgeModeActive && params.nodes.length > 0) {
                const nodeId = params.nodes[0];
                const agent = agentsData.find(a => a.nodeId === nodeId);
                if (agent) {
                    scrollToAgentCard(agent.id);
                }
            }
        });

        // Handle edge clicks for deletion
        network.on('selectEdge', async function (params) {
            console.log('selectEdge event triggered:', params);
            // Only trigger if an edge is clicked without a node being selected
            if (params.nodes.length === 0 && params.edges.length === 1) {
                const edgeId = params.edges[0];
                const edge = edgesDataset.get(edgeId);
                console.log('Edge clicked:', edgeId, edge);

                if (edge && edge.stunnel_id) {
                    console.log('Edge has stunnel_id:', edge.stunnel_id);
                    if (confirm(`Do you want to delete tunnel ${edge.stunnel_id}?`)) {
                        await deleteTunnelFromGraph(edge.stunnel_id);
                    }
                } else {
                    console.log('Edge missing stunnel_id or not found');
                }
            } else {
                console.log('Condition not met - nodes:', params.nodes.length, 'edges:', params.edges.length);
            }
        });

        // Handle node selection - only enter edge mode if edgeModeActive is true
        network.on("selectNode", function (params) {
            if (edgeModeActive) {
                network.addEdgeMode();
            }
        });

        network.on("deselectNode", function (params) {
            if (edgeModeActive) {
                network.disableEditMode();
            }
        });
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

            // Refresh data after deletion
            await fetchAgentDiscovery();
        } catch (error) {
            console.error('Error deleting tunnel:', error);
            alert(`Error deleting tunnel: ${error.message}`);
        }
    }

    // Fetch agent discovery data
    async function fetchAgentDiscovery() {
        try {
            showLoading(true);
            // Request detailed tunnel information including port and direction data
            const response = await fetch(`${API_URL}/agents/with-stunnel-plugins?detailed=true`);
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }
            const data = await response.json();
            agentsData = processAgentData(data.agents);
            updateStats(data);
            renderAgentList(agentsData);
            updateNetwork(agentsData);
            showLoading(false);
        } catch (error) {
            console.error('Error fetching agent discovery:', error);
            showError('Failed to fetch agent discovery data. Check API connection.');
            showLoading(false);
        }
    }

    // Process agent data
    function processAgentData(agents) {
        return agents.map((agent, index) => {
            const region = agent.region || agent.region_id || 'unknown';
            const agentName = agent.agent || agent.agent_id || 'unknown';
            const id = `${region}/${agentName}`;
            const nodeId = `node-${index}`;

            return {
                ...agent,
                id,
                nodeId,
                region,
                agentName,
                displayName: `${region}/${agentName}`,
                hasStunnel: agent.stunnel_plugin_found,
                tunnelCount: agent.tunnels ? agent.tunnels.length : 0
            };
        });
    }

    // Update statistics
    function updateStats(data) {
        if (!statsContainer) return;

        const stats = [
            { label: 'Total Agents', value: data.total_agents || 0, color: 'primary' },
            { label: 'Agents with Stunnel', value: data.agents_with_stunnel || 0, color: 'success' },
            { label: 'Total Tunnels', value: data.total_tunnels || 0, color: 'info' },
            { label: 'Agents without Stunnel', value: (data.total_agents || 0) - (data.agents_with_stunnel || 0), color: 'warning' }
        ];

        statsContainer.innerHTML = stats.map(stat => `
            <div class="stat-card">
                <div class="stat-value" style="color: var(--${stat.color})">${stat.value}</div>
                <div class="stat-label">${stat.label}</div>
            </div>
        `).join('');
    }

    // Render agent list
    function renderAgentList(agents) {
        if (!agentList) return;

        const searchTerm = agentSearchInput ? agentSearchInput.value.toLowerCase() : '';
        const filteredAgents = agents.filter(agent => {
            if (!searchTerm) return true;
            return agent.displayName.toLowerCase().includes(searchTerm) ||
                agent.region.toLowerCase().includes(searchTerm) ||
                agent.agentName.toLowerCase().includes(searchTerm);
        });

        agentList.innerHTML = filteredAgents.map(agent => {
            const stunnelClass = agent.hasStunnel ? 'has-stunnel' : 'no-stunnel';
            const badgeClass = agent.hasStunnel ? 'stunnel-present' : 'stunnel-absent';
            const badgeText = agent.hasStunnel ? 'Has Stunnel' : 'No Stunnel';

            let tunnelsHtml = '';
            if (agent.tunnels && agent.tunnels.length > 0) {
                tunnelsHtml = `
                    <div class="tunnel-list">
                        <strong>Tunnels (${agent.tunnels.length}):</strong>
                        ${agent.tunnels.map(tunnel => {
                    // Helper function to get tunnel field (checks both top-level and config object)
                    const getTunnelField = (tunnel, field) => {
                        return tunnel[field] || (tunnel.config && tunnel.config[field]);
                    };

                    const srcPort = getTunnelField(tunnel, 'src_port');
                    const dstPort = getTunnelField(tunnel, 'dst_port');
                    const dstHost = getTunnelField(tunnel, 'dst_host');
                    const dstAgent = getTunnelField(tunnel, 'dst_agent');
                    const dstRegion = getTunnelField(tunnel, 'dst_region');

                    const hasDetails = srcPort || dstPort || dstAgent;
                    let details = '';
                    if (hasDetails) {
                        details = `<br>${srcPort ? `Source Port: ${srcPort}` : ''}`;
                        if (dstPort) details += `${details ? '<br>' : ''}Dest Port: ${dstPort}`;
                        if (dstHost) details += `${details ? '<br>' : ''}Dest Host: ${dstHost}`;
                        if (dstAgent) details += `${details ? '<br>' : ''}Dest Agent: ${dstAgent}`;
                        if (dstRegion) details += `${details ? '<br>' : ''}Dest Region: ${dstRegion}`;
                    }
                    return `
                                <div class="tunnel-item">
                                    <strong>${tunnel.stunnel_id || 'Unknown ID'}</strong><br>
                                    Status: ${tunnel.status || 'Unknown'}${details}
                                </div>
                            `;
                }).join('')}
                    </div>
                `;
            } else if (agent.hasStunnel) {
                tunnelsHtml = '<div class="tunnel-list"><em>No tunnels configured on this agent</em></div>';
            }

            return `
                <div class="agent-card ${stunnelClass}" id="agent-${agent.id.replace(/[\/]/g, '-')}">
                    <div class="agent-header">
                        <div class="agent-id">${agent.displayName}</div>
                        <span class="stunnel-badge ${badgeClass}">${badgeText}</span>
                    </div>
                    <div class="agent-details">
                        <div><strong>Plugin ID:</strong> ${agent.stunnel_plugin_id || 'Not found'}</div>
                        <div><strong>Agent ID:</strong> ${agent.agent_id || 'N/A'}</div>
                        <div><strong>Region ID:</strong> ${agent.region_id || 'N/A'}</div>
                        ${tunnelsHtml}
                    </div>
                </div>
            `;
        }).join('');
    }

    // Helper function to get tunnel field (checks both top-level and config object)
    function getTunnelField(tunnel, field) {
        return tunnel[field] || (tunnel.config && tunnel.config[field]);
    }

    // Update network visualization
    function updateNetwork(agents) {
        if (!network) initNetwork();
        if (!network) return;

        const showTunnels = showTunnelsCheckbox ? showTunnelsCheckbox.checked : true;
        const showAllAgents = showAgentsWithoutStunnelCheckbox ? showAgentsWithoutStunnelCheckbox.checked : true;
        const showEdgeLabels = showEdgeLabelsCheckbox ? showEdgeLabelsCheckbox.checked : true;

        // Filter agents
        const filteredAgents = agents.filter(agent => {
            if (!showAllAgents && !agent.hasStunnel) return false;
            return true;
        });

        // Clear datasets
        nodesDataset.clear();
        edgesDataset.clear();
        currentNodesMap.clear();

        // Add nodes
        filteredAgents.forEach(agent => {
            const color = agent.hasStunnel ?
                (agent.tunnelCount > 0 ? '#10b981' : '#3b82f6') :
                '#6b7280';

            nodesDataset.add({
                id: agent.nodeId,
                label: agent.displayName,
                title: `Agent: ${agent.displayName}\n` +
                    `Stunnel: ${agent.hasStunnel ? 'Yes' : 'No'}\n` +
                    `Plugin: ${agent.stunnel_plugin_id || 'None'}\n` +
                    `Tunnels: ${agent.tunnelCount}`,
                color: {
                    background: color,
                    border: '#374151',
                    highlight: {
                        background: color,
                        border: '#111827'
                    }
                },
                size: agent.hasStunnel ? 25 : 20,
                shape: agent.hasStunnel ? 'star' : 'dot',
                font: {
                    color: agent.hasStunnel ? '#1f2937' : '#6b7280',
                    size: agent.hasStunnel ? 14 : 12
                }
            });
            currentNodesMap.set(agent.nodeId, agent);
        });

        // Add edges for tunnels
        if (showTunnels) {
            let edgeId = 0;
            // Track edge counts between node pairs for curvature and bundling
            const edgeGroups = {};

            // First pass: collect all edges between node pairs
            filteredAgents.forEach(srcAgent => {
                if (srcAgent.tunnels && srcAgent.tunnels.length > 0) {
                    srcAgent.tunnels.forEach(tunnel => {
                        // Get source agent from tunnel (check both top-level and config object)
                        const tunnelSrcAgent = getTunnelField(tunnel, 'src_agent');
                        const tunnelDstAgent = getTunnelField(tunnel, 'dst_agent');
                        const tunnelDstRegion = getTunnelField(tunnel, 'dst_region');

                        // Only create edge if this agent is the source of the tunnel
                        if (!tunnelSrcAgent || srcAgent.agentName !== tunnelSrcAgent) {
                            return;
                        }

                        // Try to find destination agent
                        const dstAgent = agents.find(a =>
                            a.region === tunnelDstRegion &&
                            a.agentName === tunnelDstAgent
                        );

                        if (dstAgent && filteredAgents.some(a => a.nodeId === dstAgent.nodeId)) {
                            const edgeKey = `${srcAgent.nodeId}-${dstAgent.nodeId}`;
                            if (!edgeGroups[edgeKey]) {
                                edgeGroups[edgeKey] = [];
                            }
                            edgeGroups[edgeKey].push({
                                srcAgent,
                                dstAgent,
                                tunnel,
                                edgeKey
                            });
                        }
                    });
                }
            });

            // Second pass: create edges with proper bundling
            Object.values(edgeGroups).forEach(edges => {
                if (edges.length === 0) return;

                // For multiple edges between same nodes, use bundled visualization
                const isMultiEdge = edges.length > 1;

                edges.forEach((edgeData, index) => {
                    const { srcAgent, dstAgent, tunnel } = edgeData;

                    // Build title with port information
                    let title = `Tunnel: ${tunnel.stunnel_id || 'Unknown'}\n` +
                        `From: ${srcAgent.displayName}\n` +
                        `To: ${dstAgent.displayName}\n` +
                        `Status: ${tunnel.status || 'Unknown'}`;

                    const srcPort = getTunnelField(tunnel, 'src_port');
                    const dstPort = getTunnelField(tunnel, 'dst_port');
                    const dstHost = getTunnelField(tunnel, 'dst_host');

                    if (srcPort) {
                        title += `\nSource Port: ${srcPort}`;
                    }
                    if (dstPort) {
                        title += `\nDest Port: ${dstPort}`;
                    }
                    if (dstHost && dstHost !== 'localhost') {
                        title += `\nDest Host: ${dstHost}`;
                    }

                    // Create label with port info if available
                    // For multi-edges, only show label on hover or use shorter label
                    let label = null;
                    if (showEdgeLabels) {
                        if (!isMultiEdge) {
                            // For single edge, show port info
                            if (srcPort && dstPort) {
                                label = `${srcPort}→${dstPort}`;
                            } else {
                                label = tunnel.stunnel_id ? tunnel.stunnel_id.substring(0, 6) + '...' : 'Tunnel';
                            }
                        } else {
                            // For multi-edges, use very short label or none
                            // Show just port numbers if available
                            if (srcPort && dstPort) {
                                label = `${srcPort}→${dstPort}`;
                            }
                        }
                    }

                    // Calculate curvature for edge bundling
                    // For multiple edges, spread them out more
                    let curvature = 0;
                    if (isMultiEdge) {
                        // Spread edges in a fan pattern
                        const spread = 0.6;
                        const position = (index / (edges.length - 1)) * 2 - 1; // -1 to 1
                        curvature = position * spread;
                    }

                    // Adjust edge width based on number of edges
                    const width = isMultiEdge ? 1.2 : 1.5;

                    edgesDataset.add({
                        id: `edge-${edgeId++}`,
                        stunnel_id: tunnel.stunnel_id,
                        from: srcAgent.nodeId,
                        to: dstAgent.nodeId,
                        label: label,
                        title: title,
                        arrows: {
                            to: {
                                enabled: true,
                                scaleFactor: 0.5
                            }
                        },
                        color: {
                            color: tunnel.status === 'active' ? '#8b5cf6' : '#9ca3af',
                            highlight: tunnel.status === 'active' ? '#7c3aed' : '#6b7280',
                            opacity: isMultiEdge ? 0.7 : 0.8
                        },
                        dashes: tunnel.status === 'active' ? false : [5, 5],
                        smooth: {
                            enabled: true,
                            type: 'curvedCW',
                            roundness: curvature,
                            forceDirection: isMultiEdge ? 'vertical' : 'none'
                        },
                        font: {
                            size: 9,
                            align: 'middle',
                            strokeWidth: 2,
                            strokeColor: '#ffffff'
                        },
                        width: width,
                        selectionWidth: width * 2,
                        hidden: false,
                        physics: true
                    });
                });
            });
        }
    }

    // Scroll to agent card
    function scrollToAgentCard(agentId) {
        const cardId = `agent-${agentId.replace(/[\/]/g, '-')}`;
        const card = document.getElementById(cardId);
        if (card) {
            card.scrollIntoView({ behavior: 'smooth', block: 'center' });
            card.style.boxShadow = '0 0 0 3px var(--primary-light)';
            setTimeout(() => {
                card.style.boxShadow = '';
            }, 2000);
        }
    }

    // Show loading state
    function showLoading(show) {
        const main = document.querySelector('main');
        if (!main) return;

        if (show) {
            const loadingDiv = document.createElement('div');
            loadingDiv.id = 'loadingOverlay';
            loadingDiv.innerHTML = `
                <div style="text-align: center; padding: 40px;">
                    <div style="font-size: 1.2em; margin-bottom: 20px;">Discovering agents and stunnel plugins...</div>
                    <div style="width: 40px; height: 40px; border: 4px solid var(--border); border-top: 4px solid var(--primary); border-radius: 50%; margin: 0 auto; animation: spin 1s linear infinite;"></div>
                </div>
            `;
            loadingDiv.style.position = 'absolute';
            loadingDiv.style.top = '0';
            loadingDiv.style.left = '0';
            loadingDiv.style.right = '0';
            loadingDiv.style.bottom = '0';
            loadingDiv.style.backgroundColor = 'rgba(255, 255, 255, 0.8)';
            loadingDiv.style.zIndex = '1000';
            loadingDiv.style.display = 'flex';
            loadingDiv.style.alignItems = 'center';
            loadingDiv.style.justifyContent = 'center';
            main.style.position = 'relative';
            main.appendChild(loadingDiv);
        } else {
            const loadingDiv = document.getElementById('loadingOverlay');
            if (loadingDiv) {
                loadingDiv.remove();
            }
        }
    }

    // Show error message
    function showError(message) {
        const errorDiv = document.createElement('div');
        errorDiv.className = 'alert alert-error';
        errorDiv.innerHTML = `
            <strong>Error:</strong> ${message}
            <button onclick="this.parentElement.remove()" style="margin-left: auto; background: none; border: none; color: inherit; cursor: pointer;">×</button>
        `;
        errorDiv.style.cssText = `
            background-color: var(--error-light);
            color: var(--error);
            padding: 12px 16px;
            border-radius: var(--radius);
            border: 1px solid var(--error);
            margin-bottom: 20px;
            display: flex;
            align-items: center;
        `;

        const main = document.querySelector('main');
        if (main) {
            main.insertBefore(errorDiv, main.firstChild);
            setTimeout(() => {
                if (errorDiv.parentElement) {
                    errorDiv.remove();
                }
            }, 5000);
        }
    }

    // Event listeners
    if (refreshBtn) {
        refreshBtn.addEventListener('click', fetchAgentDiscovery);
    }

    if (toggleViewBtn) {
        toggleViewBtn.addEventListener('click', () => {
            currentView = currentView === 'graph' ? 'list' : 'graph';
            const networkContainer = document.getElementById('agentNetwork');
            const listContainer = document.getElementById('agentList').parentElement.parentElement;

            if (currentView === 'graph') {
                networkContainer.style.display = 'block';
                listContainer.style.display = 'none';
                toggleViewBtn.textContent = 'Show List View';
            } else {
                networkContainer.style.display = 'none';
                listContainer.style.display = 'block';
                toggleViewBtn.textContent = 'Show Graph View';
            }
        });
    }

    if (showTunnelsCheckbox) {
        showTunnelsCheckbox.addEventListener('change', () => {
            updateNetwork(agentsData);
        });
    }

    if (showAgentsWithoutStunnelCheckbox) {
        showAgentsWithoutStunnelCheckbox.addEventListener('change', () => {
            updateNetwork(agentsData);
        });
    }

    if (showEdgeLabelsCheckbox) {
        showEdgeLabelsCheckbox.addEventListener('change', () => {
            updateNetwork(agentsData);
        });
    }

    if (agentSearchInput) {
        agentSearchInput.addEventListener('input', () => {
            renderAgentList(agentsData);
        });
    }

    // Physics toggle button
    if (togglePhysicsBtn) {
        togglePhysicsBtn.addEventListener('click', () => {
            physicsEnabled = !physicsEnabled;
            if (network) {
                network.setOptions({ physics: physicsEnabled });
                togglePhysicsBtn.textContent = physicsEnabled ? 'Physics: On' : 'Physics: Off';

                // If enabling physics, trigger stabilization
                if (physicsEnabled) {
                    network.stabilize(100);
                }
            }
        });
    }

    // Edge creation mode toggle button
    if (addEdgeBtn) {
        addEdgeBtn.addEventListener('click', () => {
            edgeModeActive = !edgeModeActive;
            if (network) {
                if (edgeModeActive) {
                    addEdgeBtn.textContent = 'Adding Edge (click a node)';
                    addEdgeBtn.classList.remove('btn-primary');
                    addEdgeBtn.classList.add('btn-secondary');
                    // Add a visual indicator
                    const networkContainer = document.getElementById('agentNetwork');
                    if (networkContainer) {
                        networkContainer.style.boxShadow = '0 0 0 3px var(--primary)';
                    }
                } else {
                    addEdgeBtn.textContent = 'Add Edge';
                    addEdgeBtn.classList.remove('btn-secondary');
                    addEdgeBtn.classList.add('btn-primary');
                    network.disableEditMode();
                    // Remove visual indicator
                    const networkContainer = document.getElementById('agentNetwork');
                    if (networkContainer) {
                        networkContainer.style.boxShadow = '';
                    }
                }
            }
        });
    }

    // Re-layout button
    if (relayoutBtn) {
        relayoutBtn.addEventListener('click', () => {
            if (network) {
                // Enable physics and stabilize to re-layout
                physicsEnabled = true;
                network.setOptions({ physics: true });
                togglePhysicsBtn.textContent = 'Physics: On';
                network.stabilize(200);

                // After stabilization, disable physics again
                setTimeout(() => {
                    network.setOptions({ physics: false });
                    physicsEnabled = false;
                    togglePhysicsBtn.textContent = 'Physics: Off';
                }, 1000);
            }
        });
    }

    // Edge creation modal handlers
    if (cancelEdgeBtn) {
        cancelEdgeBtn.addEventListener('click', () => {
            edgeModal.classList.add('hidden');
            if (edgeCreationCallback) {
                edgeCreationCallback.callback(null);
                edgeCreationCallback = null;
            }
        });
    }

    if (saveEdgeBtn) {
        saveEdgeBtn.addEventListener('click', async () => {
            if (!edgeCreationCallback) return;

            const srcPort = edgeSrcPort ? edgeSrcPort.value : '';
            const dstPort = edgeDstPort ? edgeDstPort.value : '';
            const dstHost = edgeDstHost ? edgeDstHost.value : '127.0.0.1';
            const bufferSize = edgeBufferSize ? edgeBufferSize.value : '1024';

            if (!srcPort || !dstPort || !dstHost) {
                alert("Please fill in all required fields.");
                return;
            }

            const edgeData = edgeCreationCallback.edgeData;
            const srcAgent = currentNodesMap.get(edgeData.from);
            const dstAgent = currentNodesMap.get(edgeData.to);

            if (!srcAgent || !dstAgent) {
                alert("Could not find source or destination agent data.");
                return;
            }

            const payload = {
                src_region: srcAgent.region,
                src_agent: srcAgent.agentName,
                src_port: srcPort,
                dst_region: dstAgent.region,
                dst_agent: dstAgent.agentName,
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

                // Refresh data after creation
                await fetchAgentDiscovery();

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
    }

    // Add CSS for spinner animation
    const style = document.createElement('style');
    style.textContent = `
        @keyframes spin {
            0% { transform: rotate(0deg); }
            100% { transform: rotate(360deg); }
        }
    `;
    document.head.appendChild(style);

    // Initial fetch
    fetchAgentDiscovery();
});
