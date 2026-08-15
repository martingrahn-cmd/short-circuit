// ============================================================
// net.js — room-code online transport for Short Circuit's Live Duel.
//
// Same pattern as Spinburn's sb-net.js: a thin wrapper over Supabase
// Realtime *broadcast* channels (ephemeral pub/sub — no tables, no RLS,
// public anon key is fine). One channel per 4-char room code.
//
// A duel is chatty only at the edges: a setup/go handshake, a throttled
// progress ping, the breaker slam, and a result per round. This file is
// transport only — host/join handshake plus typed sends; every other
// message type is passed through to the 'msg' handler untouched.
//
// Test/offline mode: with ?sc-local in the URL (or window.SC_NET_LOCAL),
// the same interface runs over a BroadcastChannel instead — two tabs in
// the same browser can duel with no network at all.
// ============================================================
(function (global) {
  'use strict';

  var SUPABASE_URL = 'https://nwkjayseuhvvpkdgpivm.supabase.co';
  // Public anon key (safe to ship; broadcast channels need no elevated access).
  var SUPABASE_KEY = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im53a2pheXNldWh2dnBrZGdwaXZtIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzIzNzQxMzYsImV4cCI6MjA4Nzk1MDEzNn0.lGCRdYlgxWJlzM6_XpML3f8AKUJG3tLmzNRLTPR0TnU';
  var CDN = 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/dist/umd/supabase.min.js';

  var client = null;
  var channel = null;      // supabase channel OR BroadcastChannel shim
  var handlers = {};
  var state = { role: null, code: null, connected: false };
  var joinTimer = null;

  function localMode() {
    try {
      return global.SC_NET_LOCAL === true ||
        /[?&]sc-local/.test(global.location.search);
    } catch (e) { return false; }
  }

  function stopJoinRetry() {
    if (joinTimer) { clearInterval(joinTimer); joinTimer = null; }
  }

  function ensureLib() {
    return new Promise(function (resolve, reject) {
      if (global.supabase && global.supabase.createClient) return resolve();
      var s = document.createElement('script');
      s.src = CDN;
      s.onload = function () {
        if (global.supabase && global.supabase.createClient) resolve();
        else reject(new Error('supabase-js unavailable after load'));
      };
      s.onerror = function () { reject(new Error('failed to load supabase-js')); };
      document.head.appendChild(s);
    });
  }

  function getClient() {
    if (!client) {
      client = global.supabase.createClient(SUPABASE_URL, SUPABASE_KEY, {
        realtime: { params: { eventsPerSecond: 10 } }
      });
    }
    return client;
  }

  function randCode() {
    // No easily-confused characters (0/O, 1/I/L).
    var chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
    var c = '';
    for (var i = 0; i < 4; i++) c += chars.charAt(Math.floor(Math.random() * chars.length));
    return c;
  }

  function on(event, fn) { handlers[event] = fn; }
  function emit(event, data) { if (handlers[event]) { try { handlers[event](data); } catch (e) {} } }

  function subscribe(code) {
    if (localMode()) {
      var bc = new BroadcastChannel('sc-duel-' + code);
      bc.onmessage = function (ev) { onMsg(ev.data); };
      var shim = {
        isLocal: true,
        send: function (m) { bc.postMessage(m.payload); },
        close: function () { try { bc.close(); } catch (e) {} }
      };
      return Promise.resolve(shim);
    }
    var ch = getClient().channel('sc-duel-' + code, { config: { broadcast: { self: false } } });
    ch.on('broadcast', { event: 'msg' }, function (m) { onMsg(m && m.payload); });
    return new Promise(function (resolve, reject) {
      var settled = false;
      ch.subscribe(function (status) {
        if (settled) return;
        if (status === 'SUBSCRIBED') { settled = true; resolve(ch); }
        else if (status === 'CHANNEL_ERROR' || status === 'TIMED_OUT') { settled = true; reject(new Error(status)); }
      });
    });
  }

  function send(type, payload) {
    if (!channel) return;
    channel.send({ type: 'broadcast', event: 'msg', payload: { t: type, d: payload || {} } });
  }

  function onMsg(p) {
    if (!p || !p.t) return;
    if (p.t === 'join') {
      // Guest announced itself (possibly a retry). ALWAYS re-ack — the
      // previous 'accept' may have been lost while a phone tab was
      // suspended — but only emit opponentJoined the first time.
      if (state.role === 'host') {
        send('accept', {});
        if (!state.connected) {
          state.connected = true;
          emit('opponentJoined', {});
        }
      }
    } else if (p.t === 'accept') {
      if (state.role === 'guest') {
        stopJoinRetry();
        if (!state.connected) {
          state.connected = true;
          emit('opponentJoined', {});
        }
      }
    } else if (p.t === 'bye') {
      state.connected = false;
      emit('left', {});
    } else {
      emit('msg', p);
    }
  }

  var SCNet = {
    get connected() { return state.connected; },
    get code() { return state.code; },
    get role() { return state.role; },
    on: on,

    // Create a room. Resolves with the 4-char code to share.
    host: function () {
      state.role = 'host'; state.code = randCode(); state.connected = false;
      var lib = localMode() ? Promise.resolve() : ensureLib();
      return lib.then(function () { return subscribe(state.code); }).then(function (ch) {
        channel = ch;
        return state.code;
      });
    },

    // Join a room by code. Resolves once subscribed; the connection is
    // confirmed via the 'opponentJoined' callback when the host accepts.
    join: function (code) {
      state.role = 'guest';
      state.code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
      state.connected = false;
      var lib = localMode() ? Promise.resolve() : ensureLib();
      return lib.then(function () { return subscribe(state.code); }).then(function (ch) {
        channel = ch;
        send('join', {});
        // Retry the knock until accepted: the host's tab may be suspended
        // (sharing the code in another app) and broadcast has no persistence.
        stopJoinRetry();
        joinTimer = setInterval(function () {
          if (state.connected || !channel) { stopJoinRetry(); return; }
          send('join', {});
        }, 1500);
        return state.code;
      });
    },

    // Warm up the supabase-js CDN load while the lobby is open, so
    // CREATE/JOIN don't pay the download on click.
    preload: function () {
      if (localMode()) return Promise.resolve();
      return ensureLib().catch(function () {});
    },

    send: send,

    leave: function () {
      stopJoinRetry();
      try {
        if (channel) {
          send('bye', {});
          if (channel.isLocal) channel.close();
          else getClient().removeChannel(channel);
        }
      } catch (e) {}
      channel = null;
      state.role = null; state.code = null; state.connected = false;
    }
  };

  global.SCNet = SCNet;
})(typeof window !== 'undefined' ? window : this);
