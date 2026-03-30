/**
 * User Management Page JavaScript
 * Admin-only interface for managing users and API keys
 */

document.addEventListener('DOMContentLoaded', () => {
    // Check authentication first
    if (!checkAuth()) return;

    const API_URL = localStorage.getItem('crescoApiUrl') || '/api';

    // Elements
    const usersTableBody = document.getElementById('usersTableBody');
    const apiKeysTableBody = document.getElementById('apiKeysTableBody');
    const accessDenied = document.getElementById('accessDenied');
    const usersContent = document.getElementById('usersContent');
    const addUserBtn = document.getElementById('addUserBtn');
    const addApiKeyBtn = document.getElementById('addApiKeyBtn');
    const addUserModal = document.getElementById('addUserModal');
    const addApiKeyModal = document.getElementById('addApiKeyModal');
    const changePasswordModal = document.getElementById('changePasswordModal');
    const addUserForm = document.getElementById('addUserForm');
    const addApiKeyForm = document.getElementById('addApiKeyForm');
    const changePasswordForm = document.getElementById('changePasswordForm');

    // Store current user for password change
    let currentUserId = null;

    // Check if user is admin
    async function checkAdminAccess() {
        try {
            const response = await fetch(`${API_URL}/users/me`, {
                headers: getAuthHeaders()
            });

            if (handleAuthError(response)) return false;

            if (!response.ok) {
                throw new Error('Failed to get user info');
            }

            const user = await response.json();

            if (user.role !== 'admin') {
                accessDenied.classList.remove('hidden');
                usersContent.classList.add('hidden');
                return false;
            }

            return true;
        } catch (error) {
            console.error('Error checking admin access:', error);
            accessDenied.classList.remove('hidden');
            usersContent.classList.add('hidden');
            return false;
        }
    }

    // Load users
    async function loadUsers() {
        try {
            const response = await fetch(`${API_URL}/users`, {
                headers: getAuthHeaders()
            });

            if (handleAuthError(response)) return;

            if (!response.ok) {
                throw new Error('Failed to load users');
            }

            const users = await response.json();
            renderUsers(users);
        } catch (error) {
            console.error('Error loading users:', error);
            usersTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">Error loading users: ${error.message}</td></tr>`;
        }
    }

    // Render users table
    function renderUsers(users) {
        if (users.length === 0) {
            usersTableBody.innerHTML = `<tr><td colspan="6" class="text-center text-muted">No users found</td></tr>`;
            return;
        }

        usersTableBody.innerHTML = users.map(user => `
            <tr>
                <td>${user.id}</td>
                <td>${escapeHtml(user.username)}</td>
                <td><span class="badge badge-${user.role}">${user.role}</span></td>
                <td><span class="badge badge-${user.is_active ? 'active' : 'inactive'}">${user.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>${formatDate(user.created_at)}</td>
                <td>
                    <button class="btn btn-sm" onclick="openChangePassword(${user.id}, '${escapeHtml(user.username)}')">Change Password</button>
                    <button class="btn btn-sm btn-danger" onclick="deleteUser(${user.id}, '${escapeHtml(user.username)}')">Delete</button>
                </td>
            </tr>
        `).join('');
    }

    // Load API keys
    async function loadApiKeys() {
        try {
            const response = await fetch(`${API_URL}/api-keys`, {
                headers: getAuthHeaders()
            });

            if (handleAuthError(response)) return;

            if (!response.ok) {
                throw new Error('Failed to load API keys');
            }

            const keys = await response.json();
            renderApiKeys(keys);
        } catch (error) {
            console.error('Error loading API keys:', error);
            apiKeysTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">Error loading API keys: ${error.message}</td></tr>`;
        }
    }

    // Render API keys table
    function renderApiKeys(keys) {
        if (keys.length === 0) {
            apiKeysTableBody.innerHTML = `<tr><td colspan="7" class="text-center text-muted">No API keys found</td></tr>`;
            return;
        }

        apiKeysTableBody.innerHTML = keys.map(key => `
            <tr>
                <td>${key.id}</td>
                <td>${escapeHtml(key.name)}</td>
                <td><span class="api-key-value">${key.key.substring(0, 12)}...</span></td>
                <td><span class="badge badge-${key.is_active ? 'active' : 'inactive'}">${key.is_active ? 'Active' : 'Inactive'}</span></td>
                <td>${formatDate(key.created_at)}</td>
                <td>${key.last_used ? formatDate(key.last_used) : 'Never'}</td>
                <td>
                    ${key.is_active ? 
                        `<button class="btn btn-sm btn-danger" onclick="deactivateApiKey(${key.id})">Deactivate</button>` : 
                        `<button class="btn btn-sm" onclick="deleteApiKey(${key.id})">Delete</button>`
                    }
                </td>
            </tr>
        `).join('');
    }

    // Add User
    addUserForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const username = document.getElementById('newUsername').value;
        const password = document.getElementById('newPassword').value;
        const role = document.getElementById('newRole').value;

        try {
            const response = await fetch(`${API_URL}/users`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ username, password, role })
            });

            if (handleAuthError(response)) return;

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to create user');
            }

            closeModal('addUserModal');
            addUserForm.reset();
            loadUsers();
        } catch (error) {
            alert(`Error creating user: ${error.message}`);
        }
    });

    // Add API Key
    addApiKeyForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const name = document.getElementById('apiKeyName').value;

        try {
            const response = await fetch(`${API_URL}/api-keys`, {
                method: 'POST',
                headers: getAuthHeaders(),
                body: JSON.stringify({ name })
            });

            if (handleAuthError(response)) return;

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to create API key');
            }

            const key = await response.json();

            // Show the new key
            document.getElementById('newKeyValue').textContent = key.key;
            document.getElementById('newKeyDisplay').classList.remove('hidden');

            // Refresh the table
            loadApiKeys();
        } catch (error) {
            alert(`Error creating API key: ${error.message}`);
        }
    });

    // Modal functions
    window.closeModal = function(modalId) {
        document.getElementById(modalId).classList.remove('active');
        if (modalId === 'addApiKeyModal') {
            addApiKeyForm.reset();
            document.getElementById('newKeyDisplay').classList.add('hidden');
        }
        if (modalId === 'changePasswordModal') {
            changePasswordForm.reset();
        }
    };

    // Open modals
    addUserBtn.addEventListener('click', () => {
        addUserModal.classList.add('active');
    });

    addApiKeyBtn.addEventListener('click', () => {
        addApiKeyModal.classList.add('active');
    });

    // Open change password modal
    window.openChangePassword = function(userId, username) {
        currentUserId = userId;
        document.getElementById('passwordUsername').value = username;
        changePasswordModal.classList.add('active');
    };

    // Change password form submit
    changePasswordForm.addEventListener('submit', async (e) => {
        e.preventDefault();

        const newPassword = document.getElementById('newPasswordInput').value;
        const confirmPassword = document.getElementById('confirmPasswordInput').value;

        if (newPassword !== confirmPassword) {
            alert('Passwords do not match!');
            return;
        }

        if (newPassword.length < 4) {
            alert('Password must be at least 4 characters long.');
            return;
        }

        try {
            const response = await fetch(`${API_URL}/users/${currentUserId}/password`, {
                method: 'PUT',
                headers: getAuthHeaders(),
                body: JSON.stringify({ new_password: newPassword })
            });

            if (handleAuthError(response)) return;

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to change password');
            }

            closeModal('changePasswordModal');
            alert('Password updated successfully!');
        } catch (error) {
            alert(`Error changing password: ${error.message}`);
        }
    });

    // Close modal on outside click
    [addUserModal, addApiKeyModal, changePasswordModal].forEach(modal => {
        modal.addEventListener('click', (e) => {
            if (e.target === modal) {
                modal.classList.remove('active');
            }
        });
    });

    // Deactivate user
    window.deactivateUser = async function(userId, username) {
        if (!confirm(`Are you sure you want to deactivate user "${username}"?`)) {
            return;
        }

        try {
            const response = await fetch(`${API_URL}/users/${userId}/deactivate`, {
                method: 'PUT',
                headers: getAuthHeaders()
            });

            if (handleAuthError(response)) return;

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to deactivate user');
            }

            loadUsers();
        } catch (error) {
            alert(`Error deactivating user: ${error.message}`);
        }
    };

    // Delete user
    window.deleteUser = async function(userId, username) {
        if (!confirm(`Are you sure you want to DELETE user "${username}"? This action cannot be undone!`)) {
            return;
        }

        try {
            const response = await fetch(`${API_URL}/users/${userId}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (handleAuthError(response)) return;

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to delete user');
            }

            loadUsers();
        } catch (error) {
            alert(`Error deleting user: ${error.message}`);
        }
    };

    // Deactivate API key
    window.deactivateApiKey = async function(keyId) {
        if (!confirm('Are you sure you want to deactivate this API key?')) {
            return;
        }

        try {
            const response = await fetch(`${API_URL}/api-keys/${keyId}/deactivate`, {
                method: 'PUT',
                headers: getAuthHeaders()
            });

            if (handleAuthError(response)) return;

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to deactivate API key');
            }

            loadApiKeys();
        } catch (error) {
            alert(`Error deactivating API key: ${error.message}`);
        }
    };

    // Delete API key
    window.deleteApiKey = async function(keyId) {
        if (!confirm('Are you sure you want to delete this API key?')) {
            return;
        }

        try {
            const response = await fetch(`${API_URL}/api-keys/${keyId}`, {
                method: 'DELETE',
                headers: getAuthHeaders()
            });

            if (handleAuthError(response)) return;

            if (!response.ok) {
                const data = await response.json();
                throw new Error(data.detail || 'Failed to delete API key');
            }

            loadApiKeys();
        } catch (error) {
            alert(`Error deleting API key: ${error.message}`);
        }
    };

    // Helper functions
    function escapeHtml(text) {
        const div = document.createElement('div');
        div.textContent = text;
        return div.innerHTML;
    }

    function formatDate(dateString) {
        if (!dateString) return 'N/A';
        const date = new Date(dateString);
        return date.toLocaleDateString() + ' ' + date.toLocaleTimeString();
    }

    // Initialize
    checkAdminAccess().then(isAdmin => {
        if (isAdmin) {
            loadUsers();
            loadApiKeys();
        }
    });
});
