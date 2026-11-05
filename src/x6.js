(() => {
  "use strict";

  const NODE_HEIGHT = 64;
  const SLOT_WIDTH = 272;
  const COLUMN_GAP = 32;
  const SIDE_PADDING = 32;
  const ROOT_Y = 42;
  const GROUP_START_Y = 194;
  const CHILD_GAP = 40;
  const NODE_GAP = 24;
  const GROUP_GAP = 48;

  let graph = null;
  let resizeObserver = null;
  let resizeTimer = null;
  let registered = false;
  let lastOptions = null;

  function text(value, fallback = "") {
    const normalized = String(value ?? "").trim();
    return normalized || fallback;
  }

  function shorten(value, maxLength) {
    const normalized = text(value);
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(1, maxLength - 1))}…`;
  }

  function relationId(value) {
    if (Array.isArray(value)) return relationId(value[0]);
    if (value && typeof value === "object") return text(value.id);
    return text(value);
  }

  function isOnline(status) {
    return ["up", "running", "healthy", "online"].includes(
      text(status).toLowerCase(),
    );
  }

  function statusLabel(status) {
    const normalized = text(status).toLowerCase();
    if (["up", "running", "online"].includes(normalized)) return "在线";
    if (normalized === "healthy") return "健康";
    if (["down", "offline", "stopped", "exited"].includes(normalized)) {
      return "离线";
    }
    return normalized ? text(status) : "状态未知";
  }

  function formatAddress(system) {
    const host = text(system?.host);
    const port = text(system?.port);
    return host && port ? `${host}:${port}` : host || "未配置地址";
  }

  function formatMetric(value, suffix) {
    const number = Number(value);
    return Number.isFinite(number)
      ? `${number.toFixed(number >= 10 ? 0 : 1)}${suffix}`
      : "";
  }

  function formatMemory(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return "";
    if (number <= 100) return formatMetric(number, "% MEM");
    const units = ["B", "KB", "MB", "GB", "TB"];
    let amount = number;
    let unit = 0;
    while (amount >= 1024 && unit < units.length - 1) {
      amount /= 1024;
      unit += 1;
    }
    return `${amount.toFixed(amount >= 10 ? 0 : 1)} ${units[unit]} MEM`;
  }

  function containerSubtitle(container) {
    const details = [];
    const cpu = formatMetric(container.cpu, "% CPU");
    const memory = formatMemory(container.memory);
    if (cpu) details.push(cpu);
    if (memory) details.push(memory);
    if (!details.length && container.image) details.push(shorten(container.image, 34));
    if (container.updatable) details.push("可更新");
    return details.join(" · ") || "容器";
  }

  function hasNetworkTraffic(value) {
    if (typeof value === "number") return Number.isFinite(value) && Math.abs(value) > 0;
    if (typeof value === "string") {
      const normalized = value.trim();
      if (!normalized) return false;
      const numeric = Number(normalized);
      if (Number.isFinite(numeric)) return Math.abs(numeric) > 0;
      if (/^[\[{]/.test(normalized)) {
        try {
          return hasNetworkTraffic(JSON.parse(normalized));
        } catch {
          // Fall through to values such as "12 MB/s".
        }
      }
      const match = normalized.match(/-?\d+(?:\.\d+)?/);
      return match ? Math.abs(Number(match[0])) > 0 : false;
    }
    if (Array.isArray(value)) return value.some(hasNetworkTraffic);
    if (value && typeof value === "object") {
      const entries = Object.entries(value);
      const trafficEntries = entries.filter(([key]) =>
        /(?:rx|tx|recv|sent|receive|transmit|upload|download|bandwidth|bytes|rate|speed|net)/i.test(
          key,
        ),
      );
      return (trafficEntries.length ? trafficEntries : entries).some(([, item]) =>
        hasNetworkTraffic(item),
      );
    }
    return false;
  }

  function colors() {
    const style = getComputedStyle(document.documentElement);
    const dark = document.documentElement.classList.contains("dark");
    return {
      background:
        style.getPropertyValue("--card").trim() || (dark ? "#18191a" : "#ffffff"),
      foreground:
        style.getPropertyValue("--foreground").trim() ||
        (dark ? "#f4f4f5" : "#18181b"),
      muted:
        style.getPropertyValue("--muted").trim() || (dark ? "#a1a1aa" : "#71717a"),
      border:
        style.getPropertyValue("--border").trim() ||
        (dark ? "rgba(255,255,255,.14)" : "rgba(24,24,27,.14)"),
      accent: style.getPropertyValue("--accent").trim() || "#2563eb",
      edge: dark ? "#52525b" : "#a1a1aa",
      grid: dark ? "#3f3f46" : "#d4d4d8",
      success: "#22c55e",
      danger: "#ef4444",
      warning: "#f59e0b",
      container: dark ? "#27272a" : "#fafafa",
    };
  }

  function registerNode() {
    if (registered) return;
    const { Graph } = window.X6;
    Graph.registerNode(
      "beszel-topology-node",
      {
        inherit: "rect",
        width: 240,
        height: NODE_HEIGHT,
        markup: [
          { tagName: "rect", selector: "body" },
          { tagName: "circle", selector: "status" },
          { tagName: "text", selector: "title" },
          { tagName: "text", selector: "subtitle" },
          { tagName: "text", selector: "kind" },
        ],
        attrs: {
          body: { rx: 12, ry: 12, strokeWidth: 1.5 },
          status: { cx: 18, cy: 20, r: 5, stroke: "none" },
          title: {
            refX: 32,
            refY: 21,
            fontSize: 14,
            fontWeight: 650,
            textAnchor: "start",
            textVerticalAnchor: "middle",
          },
          subtitle: {
            refX: 18,
            refY: 45,
            fontSize: 11,
            textAnchor: "start",
            textVerticalAnchor: "middle",
          },
          kind: {
            refX: 0.99,
            refX2: -16,
            refY: 21,
            fontSize: 10,
            fontWeight: 600,
            textAnchor: "end",
            textVerticalAnchor: "middle",
          },
        },
      },
      true,
    );
    registered = true;
  }

  function makeNodeAttrs(theme, options) {
    const online = isOnline(options.status);
    return {
      body: {
        fill: options.fill || theme.background,
        stroke: options.root ? theme.accent : theme.border,
        strokeWidth: options.root ? 2.5 : 1.5,
      },
      status: {
        fill: options.unknown
          ? theme.warning
          : online
            ? theme.success
            : theme.danger,
      },
      title: { text: shorten(options.title, 29), fill: theme.foreground },
      subtitle: { text: shorten(options.subtitle, 39), fill: theme.muted },
      kind: {
        text: options.kind,
        fill: options.root ? theme.accent : theme.muted,
      },
    };
  }

  function spreadOffset(index, count, span) {
    if (count <= 1) return 0;
    return -span / 2 + (span * index) / (count - 1);
  }

  function trafficLineAttrs(theme, flowing) {
    return {
      stroke: flowing ? theme.accent : theme.edge,
      strokeWidth: flowing ? 2 : 1.35,
      strokeDasharray: flowing ? "8 5" : "5 4",
      targetMarker: { name: "classic", size: 7 },
      style: {
        animation: flowing
          ? "beszel-edge-flow 0.75s linear infinite"
          : "none",
      },
    };
  }

  function addEdge(graphInstance, source, target, theme, options = {}) {
    const flowing = Boolean(options.flowing);
    graphInstance.addEdge({
      source: {
        cell: source.id,
        anchor: { name: "bottom", args: { dx: options.sourceOffset || 0 } },
      },
      target: {
        cell: target.id,
        anchor: { name: "top", args: { dx: options.targetOffset || 0 } },
      },
      router: {
        name: "manhattan",
        args: {
          padding: options.padding || 28,
          startDirections: ["bottom"],
          endDirections: ["top"],
        },
      },
      connector: { name: "rounded", args: { radius: 12 } },
      attrs: {
        line: trafficLineAttrs(theme, flowing),
      },
      data: { trafficKey: text(options.trafficKey) },
      zIndex: 0,
    });
  }

  function addSystemNode(graphInstance, system, position, theme, root = false) {
    const status = text(system?.status);
    return graphInstance.addNode({
      id: root ? "topology-root" : `system-${text(system.id, position.index)}`,
      shape: "beszel-topology-node",
      x: position.x,
      y: position.y,
      width: root ? 238 : 248,
      height: NODE_HEIGHT,
      data: { type: "system", record: system, root },
      attrs: makeNodeAttrs(theme, {
        title: text(system?.name, position.fallbackName),
        subtitle: `${statusLabel(status)} · ${formatAddress(system)}`,
        status,
        kind: root ? "ROOT" : "SYSTEM",
        root,
        unknown: !status,
      }),
      zIndex: 2,
    });
  }

  function addContainerNode(
    graphInstance,
    container,
    position,
    theme,
    onlineOverride,
  ) {
    const recordedStatus = text(container.status || container.health);
    const status =
      typeof onlineOverride === "boolean"
        ? onlineOverride
          ? "up"
          : "down"
        : recordedStatus;
    return graphInstance.addNode({
      id: `container-${text(container.id, position.index)}`,
      shape: "beszel-topology-node",
      x: position.x,
      y: position.y,
      width: 272,
      height: NODE_HEIGHT,
      data: { type: "container", record: container },
      attrs: makeNodeAttrs(theme, {
        title: text(container.name, "未命名容器"),
        subtitle: containerSubtitle(container),
        status,
        kind: "CONTAINER",
        unknown: !status,
        fill: theme.container,
      }),
      zIndex: 2,
    });
  }

  function groupData(systems, containers, rootName) {
    const safeSystems = Array.isArray(systems) ? systems : [];
    const safeContainers = Array.isArray(containers) ? containers : [];
    const normalizedRootName = text(rootName).toLocaleLowerCase();
    const rootSystem =
      safeSystems.find(
        (system) => text(system.name).toLocaleLowerCase() === normalizedRootName,
      ) || null;
    const root =
      rootSystem ||
      ({
        id: "",
        name: rootName,
        host: "",
        port: "",
        status: "up",
        virtual: true,
      });
    const rootId = text(rootSystem?.id);
    const bySystem = new Map(safeSystems.map((system) => [text(system.id), []]));
    const unassigned = [];

    for (const container of safeContainers) {
      const systemId = relationId(container.system);
      const target = bySystem.get(systemId);
      if (target) target.push(container);
      else unassigned.push(container);
    }

    const groups = safeSystems
      .filter((system) => text(system.id) !== rootId)
      .map((system) => ({ system, containers: bySystem.get(text(system.id)) || [] }));
    const rootContainers = rootId ? bySystem.get(rootId) || [] : [];

    if (unassigned.length) {
      groups.push({
        system: {
          id: "unassigned",
          name: "未分配",
          host: "容器缺少有效的 system 关联",
          status: "",
          virtual: true,
        },
        containers: unassigned,
        unassigned: true,
      });
    }

    return { root, rootSystem, groups, rootContainers };
  }

  function render(options) {
    const container = options?.container;
    if (!(container instanceof HTMLElement)) {
      throw new Error("X6 图形容器不存在。");
    }
    if (!window.X6?.Graph) {
      throw new Error("@antv/x6 未加载。");
    }

    registerNode();
    lastOptions = options;
    clearTimeout(resizeTimer);
    resizeObserver?.disconnect();
    graph?.dispose();
    container.replaceChildren();

    const theme = colors();
    const data = groupData(options.systems, options.containers, options.rootName);
    const layoutWidth = Math.max(container.clientWidth, 320);
    const columnCount = Math.max(
      1,
      Math.floor(
        (layoutWidth - SIDE_PADDING * 2 + COLUMN_GAP) /
          (SLOT_WIDTH + COLUMN_GAP),
      ),
    );
    const gridWidth = columnCount * SLOT_WIDTH + (columnCount - 1) * COLUMN_GAP;
    const gridLeft = Math.max(0, (layoutWidth - gridWidth) / 2);
    const columnHeights = Array(columnCount).fill(GROUP_START_Y);
    const groups = [];

    function shortestColumn() {
      let target = 0;
      for (let index = 1; index < columnHeights.length; index += 1) {
        if (columnHeights[index] < columnHeights[target]) target = index;
      }
      return target;
    }

    function columnX(index) {
      return gridLeft + index * (SLOT_WIDTH + COLUMN_GAP);
    }

    for (const group of data.groups) {
      const targetColumn = shortestColumn();
      const x = columnX(targetColumn);
      const systemY = columnHeights[targetColumn];
      const childPositions = group.containers.map((_, index) => ({
        x,
        y: systemY + NODE_HEIGHT + CHILD_GAP + index * (NODE_HEIGHT + NODE_GAP),
        index,
      }));
      const lastChild = childPositions.at(-1);
      const blockBottom = lastChild ? lastChild.y + NODE_HEIGHT : systemY + NODE_HEIGHT;
      columnHeights[targetColumn] = blockBottom + GROUP_GAP;
      groups.push({
        group,
        childPositions,
        systemPosition: {
          x: x + (SLOT_WIDTH - 248) / 2,
          y: systemY,
        },
      });
    }

    const rootContainerPositions = data.rootContainers.map((_, index) => {
      const targetColumn = shortestColumn();
      const position = {
        x: columnX(targetColumn),
        y: columnHeights[targetColumn],
        index,
      };
      columnHeights[targetColumn] += NODE_HEIGHT + GROUP_GAP;
      return position;
    });

    const viewportHeight = Math.max(container.clientHeight, 1);

    const { Graph } = window.X6;
    graph = new Graph({
      container,
      width: layoutWidth,
      height: viewportHeight,
      background: { color: "transparent" },
      grid: {
        visible: true,
        size: 16,
        type: "dot",
        args: { color: theme.grid, thickness: 1 },
      },
      interacting: false,
      panning: { enabled: true, eventTypes: ["leftMouseDown", "mouseWheel"] },
      mousewheel: {
        enabled: true,
        modifiers: ["ctrl", "meta"],
        minScale: 0.25,
        maxScale: 1.5,
      },
    });

    const rootNode = addSystemNode(
      graph,
      data.root,
      {
        x: (layoutWidth - 238) / 2,
        y: ROOT_Y,
        index: "root",
        fallbackName: options.rootName,
      },
      theme,
      true,
    );

    const rootEdgeCount = groups.length + data.rootContainers.length;
    let rootEdgeIndex = 0;

    for (const [index, groupLayout] of groups.entries()) {
      const systemOnline =
        !groupLayout.group.system.virtual &&
        isOnline(groupLayout.group.system.status);
      const branchFlowing = groupLayout.group.containers.some((record) =>
        hasNetworkTraffic(record.net),
      );
      const systemNode = addSystemNode(
        graph,
        groupLayout.group.system,
        {
          ...groupLayout.systemPosition,
          index,
          fallbackName: "未命名系统",
        },
        theme,
      );
      addEdge(
        graph,
        rootNode,
        systemNode,
        theme,
        {
          flowing: branchFlowing,
          trafficKey: `system-${text(groupLayout.group.system.id, index)}`,
          sourceOffset: spreadOffset(rootEdgeIndex, rootEdgeCount, 170),
          padding: 34,
        },
      );
      rootEdgeIndex += 1;
      groupLayout.group.containers.forEach((record, containerIndex) => {
        const recordedOnline = isOnline(record.status || record.health);
        const containerOnline = groupLayout.group.system.virtual
          ? recordedOnline
          : systemOnline;
        const edgeOffset = spreadOffset(
          containerIndex,
          groupLayout.group.containers.length,
          160,
        );
        const containerNode = addContainerNode(
          graph,
          record,
          groupLayout.childPositions[containerIndex],
          theme,
          containerOnline,
        );
        addEdge(
          graph,
          systemNode,
          containerNode,
          theme,
          {
            flowing: hasNetworkTraffic(record.net),
            trafficKey: `container-${text(record.id, containerIndex)}`,
            sourceOffset: edgeOffset,
            targetOffset: edgeOffset,
            padding: 20,
          },
        );
      });
    }

    data.rootContainers.forEach((record, index) => {
      const rootOnline = isOnline(data.root.status);
      const containerNode = addContainerNode(
        graph,
        record,
        rootContainerPositions[index],
        theme,
        rootOnline,
      );
      addEdge(
        graph,
        rootNode,
        containerNode,
        theme,
        {
          flowing: hasNetworkTraffic(record.net),
          trafficKey: `container-${text(record.id, index)}`,
          sourceOffset: spreadOffset(rootEdgeIndex, rootEdgeCount, 170),
          padding: 34,
        },
      );
      rootEdgeIndex += 1;
    });

    graph.on("node:click", ({ node }) => {
      const nodeData = node.getData();
      if (nodeData?.type !== "system" || nodeData.record?.virtual) return;
      const id = text(nodeData.record?.id);
      if (id) window.parent.location.href = `/system/${encodeURIComponent(id)}`;
    });

    graph.centerContent();
    graph.zoomToFit({ padding: 36, minScale: 0.55, maxScale: 1 });

    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      const height = entries[0]?.contentRect.height;
      if (!width || !height || !graph) return;
      const nextWidth = Math.max(width, 320);
      if (Math.abs(nextWidth - layoutWidth) > 1) {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => render(lastOptions || options), 100);
        return;
      }
      graph.resize(nextWidth, Math.max(height, 1));
    });
    resizeObserver.observe(container);

    return {
      rootFound: Boolean(data.rootSystem),
      root: data.root,
      systems: Array.isArray(options.systems) ? options.systems.length : 0,
      containers: Array.isArray(options.containers) ? options.containers.length : 0,
      unassigned:
        data.groups.find((group) => group.unassigned)?.containers.length || 0,
    };
  }

  function updateTraffic(options) {
    if (!graph) return null;

    lastOptions = { ...(lastOptions || {}), ...options };
    const theme = colors();
    const data = groupData(options.systems, options.containers, options.rootName);
    const trafficByEdge = new Map();

    data.groups.forEach((group, groupIndex) => {
      trafficByEdge.set(
        `system-${text(group.system.id, groupIndex)}`,
        group.containers.some((record) => hasNetworkTraffic(record.net)),
      );
      group.containers.forEach((record, containerIndex) => {
        trafficByEdge.set(
          `container-${text(record.id, containerIndex)}`,
          hasNetworkTraffic(record.net),
        );
      });
    });

    data.rootContainers.forEach((record, index) => {
      trafficByEdge.set(
        `container-${text(record.id, index)}`,
        hasNetworkTraffic(record.net),
      );
    });

    graph.getEdges().forEach((edge) => {
      const trafficKey = text(edge.getData()?.trafficKey);
      edge.attr({
        line: trafficLineAttrs(theme, Boolean(trafficByEdge.get(trafficKey))),
      });
    });

    return {
      rootFound: Boolean(data.rootSystem),
      root: data.root,
      systems: Array.isArray(options.systems) ? options.systems.length : 0,
      containers: Array.isArray(options.containers) ? options.containers.length : 0,
      unassigned:
        data.groups.find((group) => group.unassigned)?.containers.length || 0,
    };
  }

  window.BeszelTopology = Object.freeze({ render, updateTraffic });
})();
