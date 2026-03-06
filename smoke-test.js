const assert = require("assert");
const { WebSocket } = require("ws");
const { createAppServer } = require("./server");

function createClient(url) {
  const socket = new WebSocket(url);
  const queue = [];
  const waiters = [];

  socket.on("message", (raw) => {
    const message = JSON.parse(raw.toString());
    const waiterIndex = waiters.findIndex((waiter) => waiter.predicate(message));
    if (waiterIndex >= 0) {
      const waiter = waiters.splice(waiterIndex, 1)[0];
      clearTimeout(waiter.timeout);
      waiter.resolve(message);
      return;
    }
    queue.push(message);
  });

  function waitFor(predicate, timeoutMs = 5000) {
    const queueIndex = queue.findIndex(predicate);
    if (queueIndex >= 0) {
      return Promise.resolve(queue.splice(queueIndex, 1)[0]);
    }
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        const index = waiters.findIndex((waiter) => waiter.timeout === timeout);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error("Timed out waiting for message"));
      }, timeoutMs);
      waiters.push({ predicate, resolve, reject, timeout });
    });
  }

  function send(payload) {
    socket.send(JSON.stringify(payload));
  }

  async function close() {
    if (socket.readyState === WebSocket.CLOSED) return;
    await new Promise((resolve) => {
      socket.once("close", resolve);
      socket.close();
    });
  }

  return { socket, waitFor, send, close };
}

async function main() {
  const instance = createAppServer({
    matchDurationSec: 4,
    foods: { civilians: 40, cars: 10, crates: 6 },
    minFoods: { civilians: 25, cars: 6, crates: 4 },
    targetCompetitors: 4
  });
  assert.strictEqual(instance.app.config.playerRespawnDelayMs, 3000);

  const { port } = await instance.start(0);
  const baseUrl = `http://127.0.0.1:${port}`;
  const wsUrl = `ws://127.0.0.1:${port}/ws`;
  let alice;
  let bob;

  try {
    const indexHtml = await fetch(`${baseUrl}/`).then((res) => res.text());
    const clientJs = await fetch(`${baseUrl}/client/main.js`).then((res) => res.text());
    assert(indexHtml.includes("Dino Hole Rampage Online"));
    assert(indexHtml.includes("loadingOverlay"));
    assert(clientJs.includes("createRenderer"));
    assert(clientJs.includes("copyRoomCodeSafe"));

    alice = createClient(wsUrl);
    bob = createClient(wsUrl);

    await Promise.all([
      alice.waitFor((message) => message.type === "hello"),
      bob.waitFor((message) => message.type === "hello")
    ]);

    alice.send({ type: "create_room", name: "Alice" });
    const aliceJoined = await alice.waitFor((message) => message.type === "joined_room");
    const roomCode = aliceJoined.roomCode;
    await alice.waitFor((message) => message.type === "room_state" && message.players.length === 1);

    bob.send({ type: "join_room", name: "Bob", roomCode });
    await Promise.all([
      alice.waitFor((message) => message.type === "room_state" && message.players.length === 2),
      bob.waitFor((message) => message.type === "joined_room"),
      bob.waitFor((message) => message.type === "room_state" && message.players.length === 2)
    ]);

    alice.send({ type: "start_match" });
    const [aliceSnapshot, bobSnapshot] = await Promise.all([
      alice.waitFor((message) => message.type === "snapshot"),
      bob.waitFor((message) => message.type === "snapshot")
    ]);

    assert.strictEqual(aliceSnapshot.players.length, 2);
    assert.strictEqual(bobSnapshot.players.length, 2);
    assert(aliceSnapshot.bots.length >= 2);
    assert(Array.isArray(aliceSnapshot.controlPoints));
    assert.strictEqual(aliceSnapshot.controlPoints.length, 3);
    assert(Array.isArray(aliceSnapshot.turretShots));
    assert(Array.isArray(aliceSnapshot.popups));
    assert(aliceSnapshot.eventBanner && typeof aliceSnapshot.eventBanner === "object");
    assert.strictEqual(aliceSnapshot.eventBanner.text, "MATCH START");
    assert(aliceSnapshot.controlPoints.every((controlPoint) => typeof controlPoint.capture === "number"));

    const aliceSelf = aliceSnapshot.players.find((player) => player.id === aliceSnapshot.selfId);
    const bobSelf = bobSnapshot.players.find((player) => player.id === bobSnapshot.selfId);
    assert(aliceSelf);
    assert(bobSelf);

    alice.send({ type: "input", targetX: Math.min(aliceSelf.x + 250, 2100), targetY: Math.min(aliceSelf.y + 250, 3100) });
    bob.send({ type: "input", targetX: Math.max(bobSelf.x - 250, 100), targetY: Math.max(bobSelf.y - 250, 100) });

    const [aliceMoved, bobMoved] = await Promise.all([
      alice.waitFor((message) => message.type === "snapshot" && Math.abs(message.players.find((player) => player.id === message.selfId).x - aliceSelf.x) > 5, 4000),
      bob.waitFor((message) => message.type === "snapshot" && Math.abs(message.players.find((player) => player.id === message.selfId).y - bobSelf.y) > 5, 4000)
    ]);

    assert(aliceMoved.timeLeftMs < aliceSnapshot.timeLeftMs);
    assert(bobMoved.timeLeftMs < bobSnapshot.timeLeftMs);

    const matchOver = await Promise.all([
      alice.waitFor((message) => message.type === "match_over", 8000),
      bob.waitFor((message) => message.type === "match_over", 8000)
    ]);

    assert(matchOver[0].ranking.length >= 4);
    assert(matchOver[1].ranking.length >= 4);
    console.log("Smoke test passed");
  } finally {
    if (alice) await alice.close();
    if (bob) await bob.close();
    await instance.stop();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
