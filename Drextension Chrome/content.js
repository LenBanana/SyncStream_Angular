let hoveredVideoLink = null;
let browserAPI;

if (typeof browser !== "undefined") {
  // Firefox
  browserAPI = browser;
} else {
  // Chrome and others
  browserAPI = chrome;
}


// Load and inject the modal HTML
// Load and inject the modal HTML
fetch(browserAPI.runtime.getURL('modal.html'))
  .then(response => response.text())
  .then(data => {
    document.body.insertAdjacentHTML('beforeend', data);
    // Now that the modal is injected, set up the event listeners
    setupModalEventListeners();
  })
  .catch(error => {
    console.error('Error loading modal HTML:', error);
  });


// Load and inject the modal CSS
fetch(browserAPI.runtime.getURL('modal.css'))
  .then(response => response.text())
  .then(data => {
    let styleSheet = document.createElement("style");
    styleSheet.type = "text/css";
    styleSheet.innerText = data;
    document.head.appendChild(styleSheet);
  })
  .catch(error => {
    console.error('Error loading modal CSS:', error);
  });

async function hashPassword(password) {
  const encoder = new TextEncoder();
  const data = encoder.encode(password);
  const hashBuffer = await crypto.subtle.digest('SHA-512', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(byte => byte.toString(16).padStart(2, '0')).join('');
  return hashHex;
}

document.addEventListener("mouseover", function(event) {
  let target = event.target;
  while (target && target !== document.body) {
    if (target.tagName.toUpperCase() === 'A') {
      hoveredVideoLink = target.href;
      break;
    } else if (target.tagName.toUpperCase() === 'VIDEO' || target.tagName.toUpperCase() === 'AUDIO') {
      hoveredVideoLink = target.src;
      break;
    }
    target = target.parentElement;
  }
});


browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "getVideoLink") {
    sendResponse(hoveredVideoLink);
  }
  if (message.type === 'showModal') {
    showModal();
  }
});

function showModal() {
  const modalElement = document.getElementById('drextensionModal');
  if (modalElement) {
    modalElement.style.display = 'block';
  }
}

function setupModalEventListeners() {
  document.querySelector('.drextension-modal-close').addEventListener('click', function () {
    const modalElement = document.getElementById('drextensionModal');
    if (modalElement) {
      modalElement.style.display = 'none';
    }
  });
  document.getElementById('drextensionSubmitPassword').addEventListener('click', async function () {
    const password = document.getElementById('drextensionPassword').value;
    const hashedPassword = await hashPassword(password);
    browserAPI.runtime.sendMessage({type: 'passwordSubmitted', password: hashedPassword, videoLink: hoveredVideoLink});
    const modalElement = document.getElementById('drextensionModal');
    if (modalElement) {
      modalElement.style.display = 'none';
    }
  });
}


