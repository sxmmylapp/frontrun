'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { createClient } from '@/lib/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  createNotification,
  updateNotification,
  deleteNotification,
  listNotifications,
  type NotificationHistoryItem,
} from '@/lib/notifications/admin-actions';
import { toast } from 'sonner';

export default function AdminNotificationsPage() {
  const router = useRouter();
  const [isAdmin, setIsAdmin] = useState(false);
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [maxViews, setMaxViews] = useState(1);
  const [sending, setSending] = useState(false);
  const [history, setHistory] = useState<NotificationHistoryItem[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editMessage, setEditMessage] = useState('');
  const [editMaxViews, setEditMaxViews] = useState(1);
  const [acting, setActing] = useState<string | null>(null);

  useEffect(() => {
    async function init() {
      const supabase = createClient();
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return;

      const { data: profile } = await supabase
        .from('profiles')
        .select('is_admin')
        .eq('id', user.id)
        .single();

      if (!profile?.is_admin) {
        router.push('/feed');
        return;
      }
      setIsAdmin(true);

      const result = await listNotifications();
      if (result.success) {
        setHistory(result.data);
      }
    }
    init();
  }, [router]);

  async function refreshHistory() {
    const result = await listNotifications();
    if (result.success) {
      setHistory(result.data);
    }
  }

  async function handleSend() {
    if (!message.trim()) return;

    setSending(true);
    const result = await createNotification({
      title: title.trim() || undefined,
      message: message.trim(),
      maxViews: Math.max(1, maxViews),
    });
    setSending(false);

    if (result.success) {
      toast.success('Notification sent to all users');
      setTitle('');
      setMessage('');
      setMaxViews(1);
      await refreshHistory();
    } else {
      toast.error(result.error);
    }
  }

  function startEdit(n: NotificationHistoryItem) {
    setEditingId(n.id);
    setEditTitle(n.title ?? '');
    setEditMessage(n.message);
    setEditMaxViews(n.max_views);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditTitle('');
    setEditMessage('');
    setEditMaxViews(1);
  }

  async function handleUpdate(id: string) {
    if (!editMessage.trim()) return;

    setActing(id);
    const result = await updateNotification({
      id,
      title: editTitle.trim() || undefined,
      message: editMessage.trim(),
      maxViews: Math.max(1, editMaxViews),
    });
    setActing(null);

    if (result.success) {
      toast.success('Notification updated');
      cancelEdit();
      await refreshHistory();
    } else {
      toast.error(result.error);
    }
  }

  async function handleDelete(id: string) {
    setActing(id);
    const result = await deleteNotification({ id });
    setActing(null);

    if (result.success) {
      toast.success('Notification deleted');
      setHistory((prev) => prev.filter((n) => n.id !== id));
    } else {
      toast.error(result.error);
    }
  }

  if (!isAdmin) return null;

  return (
    <div className="px-4 py-4">
      <Link href="/profile" className="mb-4 inline-block text-xs text-muted-foreground hover:text-foreground">
        &larr; Back
      </Link>

      <h2 className="mt-2 text-lg font-semibold">Broadcast Notification</h2>
      <p className="mt-1 text-xs text-muted-foreground">
        Send a popup message to all users
      </p>

      {/* Create form */}
      <div className="mt-4 space-y-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Title (optional)
          </label>
          <Input
            placeholder="e.g. New Feature!"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            className="rounded-sm"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Message
          </label>
          <textarea
            placeholder="Your message to all users..."
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            className="flex min-h-[80px] w-full rounded-sm border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground">
            Max views per user
          </label>
          <Input
            type="number"
            min={1}
            max={100}
            value={maxViews || ''}
            onChange={(e) => setMaxViews(parseInt(e.target.value) || 0)}
            onBlur={() => { if (maxViews < 1) setMaxViews(1); }}
            className="w-24 rounded-sm"
          />
          <p className="text-xs text-muted-foreground">
            How many times the popup shows before auto-dismissing
          </p>
        </div>
        <Button
          className="w-full rounded-sm"
          onClick={handleSend}
          disabled={sending || !message.trim()}
        >
          {sending ? 'Sending...' : 'Send Notification'}
        </Button>
      </div>

      {/* History */}
      {history.length > 0 && (
        <div className="mt-8">
          <h3 className="mb-3 text-sm font-medium text-muted-foreground">
            Past Notifications
          </h3>
          <div className="space-y-2">
            {history.map((n) => (
              <div
                key={n.id}
                className="rounded-sm border border-border bg-card p-3"
              >
                {editingId === n.id ? (
                  <div className="space-y-2">
                    <Input
                      placeholder="Title (optional)"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      className="rounded-sm text-sm"
                    />
                    <textarea
                      value={editMessage}
                      onChange={(e) => setEditMessage(e.target.value)}
                      className="flex min-h-[60px] w-full rounded-sm border border-input bg-transparent px-3 py-2 text-sm placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                    />
                    <div className="flex items-center gap-2">
                      <label className="text-xs text-muted-foreground">Max views:</label>
                      <Input
                        type="number"
                        min={1}
                        max={100}
                        value={editMaxViews || ''}
                        onChange={(e) => setEditMaxViews(parseInt(e.target.value) || 0)}
                        onBlur={() => { if (editMaxViews < 1) setEditMaxViews(1); }}
                        className="w-20 rounded-sm text-sm"
                      />
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        className="rounded-sm"
                        onClick={() => handleUpdate(n.id)}
                        disabled={acting === n.id || !editMessage.trim()}
                      >
                        {acting === n.id ? 'Saving...' : 'Save'}
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="rounded-sm"
                        onClick={cancelEdit}
                      >
                        Cancel
                      </Button>
                    </div>
                  </div>
                ) : (
                  <>
                    {n.title && (
                      <p className="text-sm font-medium">{n.title}</p>
                    )}
                    <p className={`text-sm text-muted-foreground ${n.title ? 'mt-1' : ''}`}>
                      {n.message}
                    </p>
                    <div className="mt-2 flex items-center justify-between">
                      <div className="flex items-center gap-3 text-xs text-muted-foreground">
                        <span>{new Date(n.created_at).toLocaleDateString()}</span>
                        <span>Max views: {n.max_views}</span>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-sm px-2 text-xs text-muted-foreground hover:text-foreground"
                          onClick={() => startEdit(n)}
                        >
                          Edit
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 rounded-sm px-2 text-xs text-red-400 hover:text-red-300"
                          onClick={() => handleDelete(n.id)}
                          disabled={acting === n.id}
                        >
                          {acting === n.id ? '...' : 'Delete'}
                        </Button>
                      </div>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
