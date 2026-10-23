const API = {
  getToken() {
    return localStorage.getItem('ghostread_token');
  },

  setToken(token) {
    if (token) localStorage.setItem('ghostread_token', token);
    else localStorage.removeItem('ghostread_token');
  },

  async request(endpoint, options = {}) {
    const headers = options.headers || {};
    const token = this.getToken();
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    if (options.body && typeof options.body === 'object' && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }

    const response = await fetch(endpoint, {
      ...options,
      headers
    });

    if (response.status === 401 && !endpoint.includes('/api/auth/')) {
      this.setToken(null);
      window.location.href = '/login.html';
      throw new Error('Session expired. Please log in.');
    }

    const contentType = response.headers.get('content-type');
    let data;
    if (contentType && contentType.includes('application/json')) {
      data = await response.json();
    } else {
      data = await response.text();
    }

    if (!response.ok) {
      const errorMsg = data && data.error ? data.error : `HTTP ${response.status}`;
      throw new Error(errorMsg);
    }

    return data;
  },

  get(endpoint) {
    return this.request(endpoint, { method: 'GET' });
  },

  post(endpoint, body) {
    return this.request(endpoint, { method: 'POST', body });
  },

  put(endpoint, body) {
    return this.request(endpoint, { method: 'PUT', body });
  },

  delete(endpoint) {
    return this.request(endpoint, { method: 'DELETE' });
  },

  uploadFile(endpoint, file, onProgress) {
    return new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      const formData = new FormData();
      formData.append('pdf', file);

      xhr.open('POST', endpoint);
      const token = this.getToken();
      if (token) {
        xhr.setRequestHeader('Authorization', `Bearer ${token}`);
      }

      if (xhr.upload && onProgress) {
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) {
            const percent = Math.round((e.loaded / e.total) * 100);
            onProgress(percent);
          }
        };
      }

      xhr.onload = () => {
        let res;
        try {
          res = JSON.parse(xhr.responseText);
        } catch (_) {
          res = { error: xhr.responseText };
        }

        if (xhr.status >= 200 && xhr.status < 300) {
          resolve(res);
        } else {
          reject(new Error(res.error || `Upload failed (Status ${xhr.status})`));
        }
      };

      xhr.onerror = () => reject(new Error('Network error during upload'));
      xhr.send(formData);
    });
  },

  async getCurrentUser() {
    try {
      const data = await this.get('/api/auth/me');
      return data.user;
    } catch (_) {
      return null;
    }
  },

  logout() {
    this.post('/api/auth/logout', {}).finally(() => {
      this.setToken(null);
      window.location.href = '/login.html';
    });
  }
};
