const config = {
    apiUrl: localStorage.getItem('apiUrl') || 'http://localhost:8005'
};

document.addEventListener('DOMContentLoaded', () => {
    // API Configuration Modal
    const configModal = document.getElementById('configModal');
    const configToggle = document.getElementById('configToggle');
    const saveConfigBtn = document.getElementById('saveConfigBtn');
    const apiUrlInput = document.getElementById('apiUrl');
    
    apiUrlInput.value = config.apiUrl;
    
    configToggle.addEventListener('click', () => {
        configModal.classList.toggle('hidden');
    });

    saveConfigBtn.addEventListener('click', () => {
        const newUrl = apiUrlInput.value.trim();
        if (newUrl) {
            localStorage.setItem('apiUrl', newUrl);
            config.apiUrl = newUrl;
            configModal.classList.add('hidden');
            fetchGroups();
        }
    });

    window.addEventListener('click', (e) => {
        if (e.target === configModal) {
            configModal.classList.add('hidden');
        }
    });

    const createForm = document.getElementById('createTunnelForm');
    const submitBtn = document.getElementById('submitBtn');
    const formMessage = document.getElementById('formMessage');
    const refreshBtn = document.getElementById('refreshBtn');

    // Dynamic Destinations Logic
    const destinationsContainer = document.getElementById('destinationsContainer');
    const addDstBtn = document.getElementById('addDstBtn');

    function updateRemoveButtons() {
        const rows = destinationsContainer.querySelectorAll('.destination-row');
        const btns = destinationsContainer.querySelectorAll('.remove-dst-btn');
        btns.forEach(btn => {
            btn.disabled = rows.length <= 1;
        });
    }

    addDstBtn.addEventListener('click', () => {
        const row = document.createElement('div');
        row.className = 'destination-row';
        row.style.display = 'flex';
        row.style.gap = '10px';
        row.style.marginBottom = '10px';
        
        row.innerHTML = `
            <input type="text" class="dst-input" required placeholder="e.g., 127.0.0.1:8874" style="flex:1;">
            <button type="button" class="btn btn-secondary remove-dst-btn" style="padding:0 15px;">X</button>
        `;
        
        row.querySelector('.remove-dst-btn').addEventListener('click', () => {
            row.remove();
            updateRemoveButtons();
        });
        
        destinationsContainer.appendChild(row);
        updateRemoveButtons();
    });

    const initialRemoveBtn = destinationsContainer.querySelector('.remove-dst-btn');
    initialRemoveBtn.addEventListener('click', (e) => {
        const row = e.target.closest('.destination-row');
        row.remove();
        updateRemoveButtons();
    });

    // Create Tunnel
    createForm.addEventListener('submit', async (e) => {
        e.preventDefault();
        
        submitBtn.disabled = true;
        submitBtn.querySelector('.btn-text').textContent = 'Creating...';
        submitBtn.querySelector('.loader').classList.remove('hidden');
        formMessage.classList.add('hidden');

        try {
            const dstInputs = document.querySelectorAll('.dst-input');
            const destinations = Array.from(dstInputs).map(input => input.value.trim()).filter(v => v);

            const payload = {
                src_region: document.getElementById('src_region').value,
                src_agent: document.getElementById('src_agent').value,
                src_port: document.getElementById('src_port').value,
                dst_region: document.getElementById('dst_region').value,
                dst_agent: document.getElementById('dst_agent').value,
                destinations: destinations,
                buffer_size: document.getElementById('buffer_size').value
            };

            const response = await fetch(`${config.apiUrl}/tunnels-smart-qos`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();
            
            formMessage.classList.remove('hidden', 'error');
            formMessage.classList.add('success');
            
            if (!response.ok) {
                formMessage.classList.replace('success', 'error');
                formMessage.textContent = result.detail || 'Failed to create Smart QoS group';
                return;
            }

            formMessage.textContent = result.message;
            createForm.reset();
            // Reset dynamic fields to just one
            destinationsContainer.innerHTML = `
                <div class="destination-row" style="display:flex; gap:10px; margin-bottom:10px;">
                    <input type="text" class="dst-input" required placeholder="e.g., 127.0.0.1:8874" style="flex:1;">
                    <button type="button" class="btn btn-secondary remove-dst-btn" style="padding:0 15px;" disabled>X</button>
                </div>
            `;
            const newRemoveBtn = destinationsContainer.querySelector('.remove-dst-btn');
            newRemoveBtn.addEventListener('click', (e) => {
                const row = e.target.closest('.destination-row');
                row.remove();
                updateRemoveButtons();
            });
            updateRemoveButtons();

            fetchGroups();
        } catch (error) {
            formMessage.classList.remove('hidden', 'success');
            formMessage.classList.add('error');
            formMessage.textContent = 'Connection error. Is the API server running?';
            console.error(error);
        } finally {
            submitBtn.disabled = false;
            submitBtn.querySelector('.btn-text').textContent = 'Create Smart QoS Group';
            submitBtn.querySelector('.loader').classList.add('hidden');
        }
    });

    refreshBtn.addEventListener('click', fetchGroups);

    // Initial fetch and polling
    fetchGroups();
    setInterval(fetchGroups, 5000); // Poll every 5s for weight changes
});

async function fetchGroups() {
    const tbody = document.getElementById('groupsBody');
    try {
        const response = await fetch(`${config.apiUrl}/tunnels-smart-qos`);
        if (!response.ok) throw new Error('Network response was not ok');
        const result = await response.json();
        
        tbody.innerHTML = '';
        
        const groups = result.groups;
        if (!groups || Object.keys(groups).length === 0) {
            tbody.innerHTML = '<tr><td colspan="3" class="text-center text-muted">No active Smart QoS groups found</td></tr>';
            return;
        }

        for (const [groupId, group] of Object.entries(groups)) {
            const tr = document.createElement('tr');
            
            // Format backend tunnels
            let backendsHtml = '<div style="display: flex; flex-direction: column; gap: 5px;">';
            for (const t of group.tunnels) {
                const weightColor = t.current_weight > 0 ? '#10b981' : '#ef4444';
                backendsHtml += `
                    <div style="background: #1e293b; padding: 5px 10px; border-radius: 4px; display: inline-flex; align-items: center; justify-content: space-between; font-size: 13px;">
                        <span>Server <b>${t.haproxy_server_name}</b> (Port ${t.tunnel_port})</span>
                        <span style="color: ${weightColor}; font-weight: bold; margin-left:15px;">Weight: ${t.current_weight}</span>
                    </div>
                `;
            }
            backendsHtml += '</div>';

            tr.innerHTML = `
                <td>
                    <div class="tunnel-id" style="max-width:200px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis;" title="${groupId}">${groupId}</div>
                    <div style="font-size: 12px; color: #94a3b8; margin-top: 4px;">Plugin: <span title="${group.plugin_id}">${group.plugin_id.substring(0,8)}...</span></div>
                </td>
                <td>
                    <div><strong>${group.src_region}</strong> / ${group.src_agent}</div>
                    <div style="color: #64748b; font-size: 13px;">Bind Port: <strong>${group.src_port}</strong></div>
                </td>
                <td>${backendsHtml}</td>
            `;
            tbody.appendChild(tr);
        }

    } catch (error) {
        tbody.innerHTML = '<tr><td colspan="3" class="text-center text-error">Failed to load groups. Check connection.</td></tr>';
        console.error('Fetch error:', error);
    }
}
