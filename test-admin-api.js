const BASE = "http://localhost:5000/api";

async function run() {
  /* 1. Login */
  const loginRes = await fetch(`${BASE}/admin/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: "admin@reviewly.com", password: "Admin123!" }),
  });
  const loginData = await loginRes.json();
  console.log("LOGIN:", JSON.stringify(loginData, null, 2));

  if (!loginData.success) return;

  const token = loginData.token;

  /* 2. Get me */
  const meRes = await fetch(`${BASE}/admin/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log("ME:", JSON.stringify(await meRes.json(), null, 2));

  /* 3. Get users */
  const usersRes = await fetch(`${BASE}/admin/users?page=1&limit=5`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  console.log("USERS:", JSON.stringify(await usersRes.json(), null, 2));
}

run().catch(console.error);
