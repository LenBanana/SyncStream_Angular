let browserAPI;

if (typeof browser !== "undefined") {
  // Firefox
  browserAPI = browser;
} else {
  // Chrome and others
  browserAPI = chrome;
}

document.getElementById('save').addEventListener('click', function() {
  const apiKey = document.getElementById('apiKey').value;
  browserAPI.storage.local.set({ apiKey: apiKey }, function() {
      // Display the success message
      const status = document.getElementById('status');
      status.textContent = 'API Key saved successfully!';

      // Clear the message after 3 seconds
      setTimeout(() => {
          status.textContent = '';
      }, 3000);
  });
});

// Load any saved API key when the options page is opened
browserAPI.storage.local.get('apiKey', function(data) {
  if (data && data.apiKey) {
      document.getElementById('apiKey').value = data.apiKey;
  } else {
    console.log(data);
  }
});
