"use client";

import { useState, useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import {
  Play,
  Square,
  Plus,
  Trash2,
  Edit,
  Copy,
  Server,
  Activity,
  Clock,
  AlertCircle,
} from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { cn } from "@/lib/utils";
import {
  MockServerEngine,
  createMockServerEngine,
  type MockEndpoint,
  type MockServerConfig,
  type MockRequest,
} from "@/lib/mock-server";

const HTTP_METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS", "HEAD"];
const DEFAULT_PORT = 8090;

export default function MockServerPage() {
  const [engine, setEngine] = useState<MockServerEngine | null>(null);
  const [config, setConfig] = useState<MockServerConfig>({
    port: DEFAULT_PORT,
    cors: true,
    logRequests: true,
  });
  const [endpoints, setEndpoints] = useState<MockEndpoint[]>([]);
  const [requests, setRequests] = useState<MockRequest[]>([]);
  const [isRunning, setIsRunning] = useState(false);
  const [editEndpointId, setEditEndpointId] = useState<string | null>(null);
  const [showAddDialog, setShowAddDialog] = useState(false);

  const [newEndpoint, setNewEndpoint] = useState<Partial<MockEndpoint>>({
    name: "",
    method: "GET",
    path: "/",
    statusCode: 200,
    headers: { "Content-Type": "application/json" },
    body: "{}",
    delay: 0,
    enabled: true,
  });

  useEffect(() => {
    const mockEngine = createMockServerEngine(config);
    setEngine(mockEngine);
  }, []);

  const handleStart = () => {
    if (!engine) return;
    engine.start();
    setIsRunning(true);
  };

  const handleStop = () => {
    if (!engine) return;
    engine.stop();
    setIsRunning(false);
  };

  const handleAddEndpoint = () => {
    if (!engine) return;
    const endpoint: MockEndpoint = {
      id: `mock-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
      name: newEndpoint.name || `${newEndpoint.method} ${newEndpoint.path}`,
      method: newEndpoint.method || "GET",
      path: newEndpoint.path || "/",
      statusCode: newEndpoint.statusCode || 200,
      headers: newEndpoint.headers || { "Content-Type": "application/json" },
      body: newEndpoint.body || "{}",
      delay: newEndpoint.delay || 0,
      enabled: newEndpoint.enabled ?? true,
      createdAt: new Date().toISOString(),
      source: "manual",
    };

    engine.addEndpoint(endpoint);
    setEndpoints(engine.getEndpoints());
    setShowAddDialog(false);

    // Reset form
    setNewEndpoint({
      name: "",
      method: "GET",
      path: "/",
      statusCode: 200,
      headers: { "Content-Type": "application/json" },
      body: "{}",
      delay: 0,
      enabled: true,
    });
  };

  const handleRemoveEndpoint = (id: string) => {
    if (!engine) return;
    engine.removeEndpoint(id);
    setEndpoints(engine.getEndpoints());
  };

  const handleToggleEndpoint = (id: string, enabled: boolean) => {
    if (!engine) return;
    engine.updateEndpoint(id, { enabled });
    setEndpoints(engine.getEndpoints());
  };

  const handleClearRequests = () => {
    if (!engine) return;
    engine.clearRequests();
    setRequests([]);
  };

  const refreshEndpoints = () => {
    if (!engine) return;
    setEndpoints(engine.getEndpoints());
  };

  const refreshRequests = () => {
    if (!engine) return;
    setRequests(engine.getRequests());
  };

  useEffect(() => {
    if (!isRunning) return;
    const interval = setInterval(refreshRequests, 1000);
    return () => clearInterval(interval);
  }, [isRunning, engine]);

  return (
    <div className="container mx-auto p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-foreground">Mock Server</h1>
          <p className="text-muted-foreground mt-1">Create mock API endpoints for testing</p>
        </div>
        <div className="flex items-center gap-3">
          <Badge variant={isRunning ? "default" : "secondary"} className="h-8 px-3">
            <Server className="size-3 mr-1.5" />
            {isRunning ? "Running" : "Stopped"}
          </Badge>
          {isRunning ? (
            <Button onClick={handleStop} variant="destructive">
              <Square className="size-4 mr-2" />
              Stop Server
            </Button>
          ) : (
            <Button onClick={handleStart}>
              <Play className="size-4 mr-2" />
              Start Server
            </Button>
          )}
        </div>
      </div>

      {/* Server Config */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-semibold">Server Configuration</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-3 gap-4">
            <div className="space-y-2">
              <Label htmlFor="port">Port</Label>
              <Input
                id="port"
                type="number"
                value={config.port}
                onChange={(e) => setConfig({ ...config, port: Number(e.target.value) })}
                disabled={isRunning}
              />
            </div>
            <div className="flex items-center space-x-2 pt-8">
              <Switch
                id="cors"
                checked={config.cors}
                onCheckedChange={(checked) => setConfig({ ...config, cors: checked })}
                disabled={isRunning}
              />
              <Label htmlFor="cors">Enable CORS</Label>
            </div>
            <div className="flex items-center space-x-2 pt-8">
              <Switch
                id="log"
                checked={config.logRequests}
                onCheckedChange={(checked) => setConfig({ ...config, logRequests: checked })}
              />
              <Label htmlFor="log">Log Requests</Label>
            </div>
          </div>
          {isRunning && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground bg-muted/50 p-3 rounded">
              <AlertCircle className="size-4" />
              <span>Server running at http://localhost:{config.port}</span>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Endpoints */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Mock Endpoints</CardTitle>
            <CardDescription>{endpoints.length} endpoint(s) configured</CardDescription>
          </div>
          <Button onClick={() => setShowAddDialog(true)} size="sm">
            <Plus className="size-4 mr-2" />
            Add Endpoint
          </Button>
        </CardHeader>
        <CardContent>
          {endpoints.length === 0 ? (
            <div className="text-center py-12 text-muted-foreground">
              <Server className="size-12 mx-auto mb-3 opacity-30" />
              <p>No endpoints configured yet</p>
              <p className="text-sm mt-1">Add your first mock endpoint to get started</p>
            </div>
          ) : (
            <div className="space-y-2">
              {endpoints.map((endpoint) => (
                <div
                  key={endpoint.id}
                  className="flex items-center justify-between p-4 border border-border rounded-lg hover:bg-muted/50 transition-colors"
                >
                  <div className="flex items-center gap-4 flex-1">
                    <Switch
                      checked={endpoint.enabled}
                      onCheckedChange={(checked) => handleToggleEndpoint(endpoint.id, checked)}
                    />
                    <Badge variant="outline" className="font-mono">
                      {endpoint.method}
                    </Badge>
                    <span className="font-mono text-sm">{endpoint.path}</span>
                    <Badge variant="secondary">{endpoint.statusCode}</Badge>
                    {endpoint.delay && endpoint.delay > 0 && (
                      <Badge variant="outline" className="flex items-center gap-1">
                        <Clock className="size-3" />
                        {endpoint.delay}ms
                      </Badge>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleRemoveEndpoint(endpoint.id)}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Request Log */}
      {config.logRequests && (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Request Log</CardTitle>
              <CardDescription>{requests.length} request(s) received</CardDescription>
            </div>
            <Button onClick={handleClearRequests} size="sm" variant="outline">
              <Trash2 className="size-4 mr-2" />
              Clear Log
            </Button>
          </CardHeader>
          <CardContent>
            {requests.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <Activity className="size-8 mx-auto mb-2 opacity-30" />
                <p className="text-sm">No requests logged yet</p>
              </div>
            ) : (
              <div className="space-y-1 max-h-96 overflow-y-auto">
                {requests
                  .slice()
                  .reverse()
                  .map((req) => (
                    <div
                      key={req.id}
                      className={cn(
                        "flex items-center gap-3 p-2 text-sm rounded",
                        req.matchedEndpointId
                          ? "bg-emerald-50 dark:bg-emerald-950/20"
                          : "bg-muted/50",
                      )}
                    >
                      <Badge variant="outline" className="font-mono text-xs">
                        {req.method}
                      </Badge>
                      <span className="font-mono text-xs flex-1">{req.path}</span>
                      <span className="text-xs text-muted-foreground">
                        {new Date(req.timestamp).toLocaleTimeString()}
                      </span>
                      {req.matchedEndpointId && (
                        <Badge variant="default" className="text-xs">
                          Matched
                        </Badge>
                      )}
                    </div>
                  ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* Add Endpoint Dialog */}
      <Dialog open={showAddDialog} onOpenChange={setShowAddDialog}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle>Add Mock Endpoint</DialogTitle>
            <DialogDescription>Configure a new mock API endpoint</DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="name">Name</Label>
              <Input
                id="name"
                value={newEndpoint.name}
                onChange={(e) => setNewEndpoint({ ...newEndpoint, name: e.target.value })}
                placeholder="My Mock Endpoint"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="method">Method</Label>
                <Select
                  value={newEndpoint.method}
                  onValueChange={(method) => setNewEndpoint({ ...newEndpoint, method })}
                >
                  <SelectTrigger id="method">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {HTTP_METHODS.map((m) => (
                      <SelectItem key={m} value={m}>
                        {m}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="status">Status Code</Label>
                <Input
                  id="status"
                  type="number"
                  value={newEndpoint.statusCode}
                  onChange={(e) =>
                    setNewEndpoint({ ...newEndpoint, statusCode: Number(e.target.value) })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="path">Path</Label>
              <Input
                id="path"
                value={newEndpoint.path}
                onChange={(e) => setNewEndpoint({ ...newEndpoint, path: e.target.value })}
                placeholder="/api/users/:id"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delay">Delay (ms)</Label>
              <Input
                id="delay"
                type="number"
                value={newEndpoint.delay}
                onChange={(e) => setNewEndpoint({ ...newEndpoint, delay: Number(e.target.value) })}
                placeholder="0"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="body">Response Body</Label>
              <textarea
                id="body"
                className="w-full min-h-[200px] p-3 border border-border rounded-md font-mono text-sm"
                value={newEndpoint.body}
                onChange={(e) => setNewEndpoint({ ...newEndpoint, body: e.target.value })}
                placeholder='{"success": true}'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setShowAddDialog(false)}>
              Cancel
            </Button>
            <Button onClick={handleAddEndpoint}>Add Endpoint</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
