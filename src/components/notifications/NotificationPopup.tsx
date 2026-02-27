'use client';

import { useEffect, useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  getUnreadNotifications,
  dismissNotification,
  type UnreadNotification,
} from '@/lib/notifications/actions';

export function NotificationPopup() {
  const [notifications, setNotifications] = useState<UnreadNotification[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [dismissing, setDismissing] = useState(false);

  useEffect(() => {
    async function load() {
      const result = await getUnreadNotifications();
      if (result.success) {
        setNotifications(result.data);
      }
    }
    load();
  }, []);

  if (notifications.length === 0) return null;

  const current = notifications[currentIndex];
  if (!current) return null;

  const isLast = currentIndex >= notifications.length - 1;
  const remaining = notifications.length - currentIndex;

  async function handleDismiss() {
    setDismissing(true);
    await dismissNotification(current.id);
    setDismissing(false);

    if (isLast) {
      setNotifications([]);
    } else {
      setCurrentIndex((i) => i + 1);
    }
  }

  async function handleDismissAll() {
    setDismissing(true);
    const remaining = notifications.slice(currentIndex);
    await Promise.all(remaining.map((n) => dismissNotification(n.id)));
    setDismissing(false);
    setNotifications([]);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-sm border border-border bg-card p-5">
        {remaining > 1 && (
          <p className="mb-2 text-xs text-muted-foreground">
            {currentIndex + 1} of {notifications.length}
          </p>
        )}

        {current.title && (
          <h3 className="text-base font-semibold">{current.title}</h3>
        )}
        <p className={`text-sm leading-relaxed ${current.title ? 'mt-2' : ''}`}>
          {current.message}
        </p>
        <p className="mt-3 text-xs text-muted-foreground">
          {new Date(current.created_at).toLocaleDateString()}
        </p>

        <div className="mt-4 flex gap-2">
          {remaining > 1 && (
            <Button
              variant="secondary"
              size="sm"
              className="flex-1 rounded-sm"
              onClick={handleDismissAll}
              disabled={dismissing}
            >
              Dismiss All
            </Button>
          )}
          <Button
            size="sm"
            className="flex-1 rounded-sm"
            onClick={handleDismiss}
            disabled={dismissing}
          >
            {isLast ? 'Got it' : 'Next'}
          </Button>
        </div>
      </div>
    </div>
  );
}
