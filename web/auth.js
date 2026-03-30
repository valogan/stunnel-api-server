/**
 * Authentication Helper Module
 * Include this file before other JS files to enable authentication
 */

// Check if user is authenticated, redirect to login if not
function checkAuth() {
    const token = localStorage.getItem('access_token');
    if (!token) {
        window.location.href = 'login.html';
        return false;
    }
    return true;
}

// Get authentication headers for API requests
function getAuthHeaders() {
    const token = localStorage.getItem('access_token');
    const headers = {
        'Content-Type': 'application/json',
        'Accept': 'application/json'
    };
    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }
    return headers;
}

// Handle authentication errors (401 responses)
function handleAuthError(response) {
    if (response.status === 401) {
        localStorage.removeItem('access_token');
        localStorage.removeItem('token_type');
        window.location.href = 'login.html';
        return true;
    }
    return false;
}

// Logout function
function logout() {
    localStorage.removeItem('access_token');
    localStorage.removeItem('token_type');
    window.location.href = 'login.html';
}

// Check token validity with the server
async function validateToken(API_URL) {
    const token = localStorage.getItem('access_token');
    if (!token) return false;
    
    try {
        const response = await fetch(`${API_URL}/users/me`, {
            headers: getAuthHeaders()
        });
        return response.ok;
    } catch {
        return false;
    }
}

// Setup logout button handler - call this after DOM is loaded
function setupLogoutButton() {
    const logoutBtn = document.getElementById('logoutBtn');
    if (logoutBtn) {
        logoutBtn.addEventListener('click', (e) => {
            e.preventDefault();
            logout();
        });
    }
}

// Auto-setup logout button when DOM is ready
document.addEventListener('DOMContentLoaded', setupLogoutButton);
