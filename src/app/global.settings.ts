export var dealCardSound = '/assets/sound/deal_card.mp3';
export var smileys: string[] = ('😀 😃 😄 😁 😆 😅 😂 🤣 😊 😇 🙂 🙃 😉 😌 😍 😘 😗 😙 😚 😋 😜 😝 😛 🤑 🤗 🤓 😎 🤡 🤠 😏 😒 😞 😔 😟 😕 🙁 ☹️ 😣 😖 😫 😩 😤 😠 😡 😶 😐 😑 😯 😦 😧 😮 😲 😵 😳 😱 😨 😰 😢 😥 🤤 😭 😓 😪 😴 🙄 🤔 🤥 😬 🤐 🤢 🤮 🤧 😷 🤒 🤕 🤨 🤩 🤯 🧐 🤫 🤪 🤭').split(' ');

export function getCookie(name) {
  const value = `; ${document.cookie}`;
  const parts = value.split(`; ${name}=`);
  if (parts.length === 2) return parts.pop().split(';').shift();
}

export var token = getCookie("login-token");
export var userId = Number.parseInt(getCookie("user-id"));

export function resetToken() {
  token = getCookie("login-token");
  userId = Number.parseInt(getCookie("user-id"));
}
