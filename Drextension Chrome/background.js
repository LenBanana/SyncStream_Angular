let browserAPI;

if (typeof browser !== "undefined") {
  // Firefox
  browserAPI = browser;
} else {
  // Chrome and others
  browserAPI = chrome;
}

// Add a custom right-click option
browserAPI.contextMenus.create({
  id: "sendToDreckTube",
  title: "Send to DreckTube",
  contexts: ["link", "image"],
  documentUrlPatterns: ["*://www.youtube.com/*", "*://www.twitch.tv/*"]
});

browserAPI.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "sendToDreckTube") {
    browserAPI.tabs.sendMessage(tab.id, {type: "getVideoLink"}, (videoLink) => {
      sendToRoom(videoLink);
    });
  }
});

function sendToRoom(videoLink, password = null) {
  if (videoLink) {
    isInRoom((roomName) => {
      if (roomName) {
        getApiKey((apiKey) => {
          if (apiKey) {
            if (password) {
              sendToAPI(videoLink, roomName, apiKey, password);
            } else {
              // Check if a password is stored
              browserAPI.storage.local.get('storedPassword', function (data) {
                if (data && data.storedPassword) {
                  sendToAPI(videoLink, roomName, apiKey, data.storedPassword);
                } else {
                  sendToAPI(videoLink, roomName, apiKey);
                }
              });
            }
          } else {
            alertUser("API Key Missing", "Please set the API key in the extension options.");
          }
        });
      } else {
        alertUser("Not in a Room", "Please join a room on drecktu.be before using this feature.");
      }
    });
  }
}

function isInRoom(callback) {
  browserAPI.tabs.query({}, function (tabs) {
    for (let tab of tabs) {
      if (tab.url.startsWith("https://drecktu.be/room/")) {
        const roomName = tab.url.split("https://drecktu.be/room/")[1];
        callback(roomName);
        return;
      }
    }
    callback(null);  // No matching tab found
  });
}

function getApiKey(callback) {
  browserAPI.storage.local.get('apiKey', function (data) {
    callback(data.apiKey || null);
  });
}

browserAPI.runtime.onMessage.addListener(function (request, sender, sendResponse) {
  if (request.type === 'passwordSubmitted') {
    const password = request.password;
    const videoLink = request.videoLink;
    sendToRoom(videoLink, password);
  }
});

function sendToAPI(videoLink, roomName, apiKey, password = null, retrying = false) {
  const baseUrl = 'https://sync.dreckbu.de/api/extension/AddVideoByExtension';
  let url = `${baseUrl}?apiKey=${encodeURIComponent(apiKey)}&roomId=${encodeURIComponent(roomName)}&videoUrl=${encodeURIComponent(videoLink)}`;
  if (password) {
    url += `&password=${encodeURIComponent(password)}`;
  }

  fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    }
  })
    .then(response => {
      if (response.status === 401) {
        browserAPI.tabs.query({active: true, currentWindow: true}, function (tabs) {
          browserAPI.tabs.sendMessage(tabs[0].id, {type: 'showModal'});
        });
      } else if (response.status === 200 && password) {
        // If the call was successful and a password was used, store the password
        browserAPI.storage.local.set({storedPassword: password});
      }
      return response.json();
    })
    .then(data => {
      console.log('Success:', data);
    })
    .catch((error) => {
      console.error('Error:', error);
    });
}


function alertUser(title, message) {
  browserAPI.notifications.create({
    type: 'basic',
    iconUrl: 'img/notification.png', // Ensure this path points to your notification icon
    title: title,
    message: message
  });
}
