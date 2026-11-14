import { clock } from '../clock.js';
import { sendJson } from '../http.js';
import { createPlayer, previewNextAttempt } from '../players-repo.js';
import { issuePlayerSession, readPlayerSession } from '../session.js';

export function registerPlayerRoutes(routes, db) {
  routes.push({
    method: 'POST',
    pattern: /^\/api\/players$/,
    handler: (req, res) => {
      const now = clock.now();
      const existing = readPlayerSession(db, req, now);

      if (existing) {
        sendJson(res, 200, {
          playerId: existing.player.id,
          nextAttempt: previewNextAttempt(existing.player),
        });
        return;
      }

      const player = createPlayer(db, now);
      issuePlayerSession(db, res, player.id, now);

      sendJson(res, 201, {
        playerId: player.id,
        nextAttempt: previewNextAttempt(player),
      });
    },
  });

  routes.push({
    method: 'POST',
    pattern: /^\/api\/players\/switch$/,
    handler: (req, res) => {
      const now = clock.now();
      const player = createPlayer(db, now);
      issuePlayerSession(db, res, player.id, now);

      sendJson(res, 201, {
        playerId: player.id,
        nextAttempt: previewNextAttempt(player),
      });
    },
  });
}
