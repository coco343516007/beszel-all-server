(() => {
  "use strict";

  const NODE_HEIGHT = 64;
  const GRID_SIZE = 16;
  const ROUTER_STEP = 8;
  const ROUTER_MAX_LOOPS = 10_000;
  const SYSTEM_NODE_WIDTH = 248;
  const ROOT_NODE_WIDTH = 238;
  const SLOT_WIDTH = 272;
  const BASE_COLUMN_GAP = 32;
  const EDGE_LANE_GAP = 12;
  const EDGE_LANE_MARGIN = 16;
  const ROOT_CONTAINER_GAP = 24;
  const ROOT_EDGE_LANE_GAP = 12;
  const ROOT_EDGE_LANE_MARGIN = 16;
  const SYSTEM_EDGE_LANE_GAP = 24;
  const SYSTEM_EDGE_LANE_MARGIN = 16;
  const ROOT_TO_SYSTEM_MIN_GAP = 72;
  const SIDE_PADDING = 32;
  const ROOT_CONTAINER_Y = 32;
  const ROOT_Y_WITHOUT_CONTAINERS = 42;
  const CHILD_GAP = 40;
  const NODE_GAP = 24;
  const GROUP_GAP = 48;
  const SYSTEM_ORBIT_X = 520;
  const SYSTEM_ORBIT_Y = 400;
  const FAN_START_RADIUS = 360;
  const FAN_RING_GAP = 220;
  const FAN_FIRST_CAPACITY = 5;
  const FAN_CAPACITY_STEP = 2;
  const FAN_MAX_SPAN = 144;

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
    const radial = Boolean(options.radial);
    const sourceSide = options.sourceSide || "bottom";
    const targetSide = options.targetSide || "top";

    function anchor(side, offset = 0) {
      const args = ["left", "right"].includes(side)
        ? { dy: offset }
        : { dx: offset };
      return { name: side, args };
    }

    graphInstance.addEdge({
      source: {
        cell: source.id,
        anchor: radial
          ? { name: "center" }
          : anchor(sourceSide, options.sourceOffset || 0),
      },
      target: {
        cell: target.id,
        anchor: radial
          ? { name: "center" }
          : anchor(targetSide, options.targetOffset || 0),
      },
      vertices: Array.isArray(options.vertices) ? options.vertices : [],
      router: radial
        ? { name: "normal" }
        : {
            name: "manhattan",
            args: {
              step: ROUTER_STEP,
              maxLoopCount: ROUTER_MAX_LOOPS,
              padding: options.padding || 28,
              startDirections: [sourceSide],
              endDirections: [targetSide],
            },
          },
      connector: radial
        ? { name: "smooth" }
        : { name: "rounded", args: { radius: 12 } },
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
      width: root ? ROOT_NODE_WIDTH : SYSTEM_NODE_WIDTH,
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
      width: SYSTEM_NODE_WIDTH,
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

  function polarPoint(center, radiusX, radiusY, angleDegrees) {
    const angle = (angleDegrees * Math.PI) / 180;
    return {
      x: center.x + Math.cos(angle) * radiusX,
      y: center.y + Math.sin(angle) * radiusY,
    };
  }

  function fanPositions(center, directionDegrees, count) {
    const positions = [];
    let remaining = count;
    let offset = 0;
    let ring = 0;

    while (remaining > 0) {
      const capacity = FAN_FIRST_CAPACITY + ring * FAN_CAPACITY_STEP;
      const ringCount = Math.min(remaining, capacity);
      const radius = FAN_START_RADIUS + ring * FAN_RING_GAP;
      const span =
        ringCount <= 1
          ? 0
          : Math.min(FAN_MAX_SPAN, (ringCount - 1) * 36);

      for (let index = 0; index < ringCount; index += 1) {
        const progress = ringCount <= 1 ? 0.5 : index / (ringCount - 1);
        const angle = directionDegrees - span / 2 + span * progress;
        const point = polarPoint(center, radius, radius, angle);
        positions.push({
          x: point.x - SYSTEM_NODE_WIDTH / 2,
          y: point.y - NODE_HEIGHT / 2,
          center: point,
          angle,
          index: offset + index,
        });
      }

      remaining -= ringCount;
      offset += ringCount;
      ring += 1;
    }

    return positions;
  }

  function smoothVertex(source, target, bend = 0) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.hypot(dx, dy) || 1;
    return {
      x: (source.x + target.x) / 2 - (dy / distance) * bend,
      y: (source.y + target.y) / 2 + (dx / distance) * bend,
    };
  }

  function renderRadial(options, data, theme, container, layoutWidth) {
    const viewportHeight = Math.max(container.clientHeight, 1);
    const center = {
      x: layoutWidth / 2,
      y: viewportHeight / 2,
    };
    const { Graph } = window.X6;

    graph = new Graph({
      container,
      width: layoutWidth,
      height: viewportHeight,
      background: { color: "transparent" },
      grid: {
        visible: true,
        size: GRID_SIZE,
        type: "dot",
        args: { color: theme.grid, thickness: 1 },
      },
      interacting: false,
      panning: { enabled: true, eventTypes: ["leftMouseDown", "mouseWheel"] },
      mousewheel: {
        enabled: true,
        modifiers: ["ctrl", "meta"],
        minScale: 0.2,
        maxScale: 1.5,
      },
    });

    const rootNode = addSystemNode(
      graph,
      data.root,
      {
        x: center.x - ROOT_NODE_WIDTH / 2,
        y: center.y - NODE_HEIGHT / 2,
        index: "root",
        fallbackName: options.rootName,
      },
      theme,
      true,
    );

    const renderedGroups = data.groups.map((group, index) => {
      const angle =
        data.groups.length <= 1
          ? 90
          : 180 - (180 * index) / (data.groups.length - 1);
      const systemCenter = polarPoint(
        center,
        SYSTEM_ORBIT_X,
        SYSTEM_ORBIT_Y,
        angle,
      );
      const systemOnline = !group.system.virtual && isOnline(group.system.status);
      const systemNode = addSystemNode(
        graph,
        group.system,
        {
          x: systemCenter.x - SYSTEM_NODE_WIDTH / 2,
          y: systemCenter.y - NODE_HEIGHT / 2,
          index,
          fallbackName: "未命名系统",
        },
        theme,
      );
      const childPositions = fanPositions(
        systemCenter,
        angle,
        group.containers.length,
      );
      const containerNodes = group.containers.map((record, containerIndex) => {
        const recordedOnline = isOnline(record.status || record.health);
        const containerOnline = group.system.virtual
          ? recordedOnline
          : systemOnline;
        return addContainerNode(
          graph,
          record,
          childPositions[containerIndex],
          theme,
          containerOnline,
        );
      });
      return {
        angle,
        group,
        index,
        systemCenter,
        systemNode,
        childPositions,
        containerNodes,
      };
    });

    const rootContainerPositions = fanPositions(
      center,
      -90,
      data.rootContainers.length,
    );
    const rootOnline = isOnline(data.root.status);
    const rootContainerNodes = data.rootContainers.map((record, index) =>
      addContainerNode(
        graph,
        record,
        rootContainerPositions[index],
        theme,
        rootOnline,
      ),
    );

    renderedGroups.forEach((layout) => {
      const branchFlowing = layout.group.containers.some((record) =>
        hasNetworkTraffic(record.net),
      );
      addEdge(graph, rootNode, layout.systemNode, theme, {
        radial: true,
        flowing: branchFlowing,
        trafficKey: `system-${text(layout.group.system.id, layout.index)}`,
        vertices: [
          smoothVertex(
            center,
            layout.systemCenter,
            spreadOffset(layout.index, renderedGroups.length, 44),
          ),
        ],
      });

      layout.group.containers.forEach((record, index) => {
        const target = layout.childPositions[index].center;
        addEdge(
          graph,
          layout.systemNode,
          layout.containerNodes[index],
          theme,
          {
            radial: true,
            flowing: hasNetworkTraffic(record.net),
            trafficKey: `container-${text(record.id, index)}`,
            vertices: [
              smoothVertex(
                layout.systemCenter,
                target,
                spreadOffset(index, layout.group.containers.length, 28),
              ),
            ],
          },
        );
      });
    });

    data.rootContainers.forEach((record, index) => {
      const target = rootContainerPositions[index].center;
      addEdge(graph, rootNode, rootContainerNodes[index], theme, {
        radial: true,
        flowing: hasNetworkTraffic(record.net),
        trafficKey: `container-${text(record.id, index)}`,
        vertices: [
          smoothVertex(
            center,
            target,
            spreadOffset(index, data.rootContainers.length, 28),
          ),
        ],
      });
    });

    graph.on("node:click", ({ node }) => {
      const nodeData = node.getData();
      if (nodeData?.type !== "system" || nodeData.record?.virtual) return;
      const id = text(nodeData.record?.id);
      if (id) window.parent.location.href = `/system/${encodeURIComponent(id)}`;
    });

    graph.centerContent();
    graph.zoomToFit({ padding: 52, minScale: 0.22, maxScale: 0.9 });

    resizeObserver = new ResizeObserver((entries) => {
      const width = entries[0]?.contentRect.width;
      const height = entries[0]?.contentRect.height;
      if (!width || !height || !graph) return;
      const nextWidth = Math.max(width, 320);
      const nextHeight = Math.max(height, 1);
      if (
        Math.abs(nextWidth - layoutWidth) > 1 ||
        Math.abs(nextHeight - viewportHeight) > 1
      ) {
        clearTimeout(resizeTimer);
        resizeTimer = setTimeout(() => render(lastOptions || options), 100);
        return;
      }
      graph.resize(nextWidth, nextHeight);
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
    return renderRadial(options, data, theme, container, layoutWidth);
    const rootCenterIndex = Math.floor(data.rootContainers.length / 2);
    const rootSideLaneCount = data.rootContainers.length
      ? Math.max(
          rootCenterIndex,
          data.rootContainers.length - rootCenterIndex - 1,
        )
      : 0;
    const rootEdgeLaneSpace = data.rootContainers.length
      ? Math.max(
          48,
          ROOT_EDGE_LANE_MARGIN * 2 +
            Math.max(0, rootSideLaneCount - 1) * ROOT_EDGE_LANE_GAP,
        )
      : 0;
    const rootY = data.rootContainers.length
      ? ROOT_CONTAINER_Y + NODE_HEIGHT + rootEdgeLaneSpace
      : ROOT_Y_WITHOUT_CONTAINERS;
    const systemCenterIndex = Math.floor(data.groups.length / 2);
    const systemSideLaneCount = data.groups.length
      ? Math.max(
          systemCenterIndex,
          data.groups.length - systemCenterIndex - 1,
        )
      : 0;
    const systemEdgeLaneSpace = data.groups.length
      ? Math.max(
          ROOT_TO_SYSTEM_MIN_GAP,
          SYSTEM_EDGE_LANE_MARGIN * 2 +
            Math.max(0, systemSideLaneCount - 1) * SYSTEM_EDGE_LANE_GAP,
        )
      : 0;
    const systemY = rootY + NODE_HEIGHT + systemEdgeLaneSpace;
    // Every non-root system owns one column so the complete system layer is
    // always laid out horizontally. The canvas is zoomed to fit when the row
    // is wider than the viewport.
    const columnCount = Math.max(1, data.groups.length);
    const columnHeights = Array(columnCount).fill(systemY);
    const groups = [];

    for (const [groupIndex, group] of data.groups.entries()) {
      const targetColumn = groupIndex;
      const childPositions = group.containers.map((_, index) => ({
        y: systemY + NODE_HEIGHT + CHILD_GAP + index * (NODE_HEIGHT + NODE_GAP),
        index,
      }));
      const lastChild = childPositions.at(-1);
      const blockBottom = lastChild ? lastChild.y + NODE_HEIGHT : systemY + NODE_HEIGHT;
      columnHeights[targetColumn] = blockBottom + GROUP_GAP;
      groups.push({
        group,
        column: targetColumn,
        childPositions,
        systemPosition: {
          y: systemY,
        },
      });
    }

    const rootContainerPositions = data.rootContainers.map((_, index) => ({
      y: ROOT_CONTAINER_Y,
      index,
    }));

    const columnLaneCounts = Array(columnCount).fill(0);
    groups.forEach(({ column, group }) => {
      columnLaneCounts[column] = Math.max(
        columnLaneCounts[column],
        Math.max(0, group.containers.length - 1),
      );
    });
    const columnGaps = columnLaneCounts.map((laneCount) =>
      Math.max(
        BASE_COLUMN_GAP,
        EDGE_LANE_MARGIN * 2 + Math.max(0, laneCount - 1) * EDGE_LANE_GAP,
      ),
    );
    const columnOffsets = Array(columnCount).fill(0);
    for (let index = 1; index < columnCount; index += 1) {
      columnOffsets[index] =
        columnOffsets[index - 1] + SLOT_WIDTH + columnGaps[index - 1];
    }
    const nodeGridWidth = columnOffsets.at(-1) + SLOT_WIDTH;
    const systemContentWidth = nodeGridWidth + columnGaps.at(-1);
    const rootContainerWidth = data.rootContainers.length
      ? SYSTEM_NODE_WIDTH +
        (data.rootContainers.length - 1) *
          (SLOT_WIDTH + ROOT_CONTAINER_GAP)
      : 0;
    const contentWidth = Math.max(systemContentWidth, rootContainerWidth);
    const contentLeft = Math.max(SIDE_PADDING, (layoutWidth - contentWidth) / 2);
    const gridLeft = data.groups.length
      ? contentLeft +
        contentWidth / 2 -
        (columnOffsets[systemCenterIndex] + SLOT_WIDTH / 2)
      : contentLeft;
    const rootContainerLeft =
      contentLeft + Math.max(0, (contentWidth - rootContainerWidth) / 2);

    function columnX(index) {
      return gridLeft + columnOffsets[index];
    }

    groups.forEach((groupLayout) => {
      const x = columnX(groupLayout.column);
      groupLayout.systemPosition.x =
        x + (SLOT_WIDTH - SYSTEM_NODE_WIDTH) / 2;
      groupLayout.laneStartX = x + SLOT_WIDTH + EDGE_LANE_MARGIN;
      groupLayout.childPositions.forEach((position) => {
        position.x = x + (SLOT_WIDTH - SYSTEM_NODE_WIDTH) / 2;
      });
    });
    rootContainerPositions.forEach((position, index) => {
      position.x =
        rootContainerLeft + index * (SLOT_WIDTH + ROOT_CONTAINER_GAP);
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
        size: GRID_SIZE,
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
        x: contentLeft + (contentWidth - ROOT_NODE_WIDTH) / 2,
        y: rootY,
        index: "root",
        fallbackName: options.rootName,
      },
      theme,
      true,
    );

    // Manhattan routing can only avoid nodes that already exist in the graph.
    // Create every node first, then calculate all edges against the complete
    // obstacle set.
    const renderedGroups = groups.map((groupLayout, index) => {
      const systemOnline =
        !groupLayout.group.system.virtual &&
        isOnline(groupLayout.group.system.status);
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
      const containerNodes = groupLayout.group.containers.map(
        (record, containerIndex) => {
          const recordedOnline = isOnline(record.status || record.health);
          const containerOnline = groupLayout.group.system.virtual
            ? recordedOnline
            : systemOnline;
          return addContainerNode(
            graph,
            record,
            groupLayout.childPositions[containerIndex],
            theme,
            containerOnline,
          );
        },
      );
      return { groupLayout, index, systemNode, containerNodes };
    });

    const rootOnline = isOnline(data.root.status);
    const rootContainerNodes = data.rootContainers.map((record, index) =>
      addContainerNode(
        graph,
        record,
        rootContainerPositions[index],
        theme,
        rootOnline,
      ),
    );

    const rootEdgeCount = renderedGroups.length;

    renderedGroups.forEach(
      ({ groupLayout, index, systemNode, containerNodes }) => {
        const branchFlowing = groupLayout.group.containers.some((record) =>
          hasNetworkTraffic(record.net),
        );
        if (index === systemCenterIndex) {
          addEdge(
            graph,
            rootNode,
            systemNode,
            theme,
            {
              flowing: branchFlowing,
              trafficKey: `system-${text(groupLayout.group.system.id, index)}`,
              sourceSide: "bottom",
              targetSide: "top",
              padding: 4,
            },
          );
        } else {
          const sourceOffset = spreadOffset(index, rootEdgeCount, 170);
          const sourceX = contentLeft + contentWidth / 2 + sourceOffset;
          const targetX =
            groupLayout.systemPosition.x + SYSTEM_NODE_WIDTH / 2;
          const distanceFromCenter = Math.abs(index - systemCenterIndex);
          const laneY =
            rootY +
            NODE_HEIGHT +
            SYSTEM_EDGE_LANE_MARGIN +
            (systemSideLaneCount - distanceFromCenter) *
              SYSTEM_EDGE_LANE_GAP;
          addEdge(
            graph,
            rootNode,
            systemNode,
            theme,
            {
              flowing: branchFlowing,
              trafficKey: `system-${text(groupLayout.group.system.id, index)}`,
              sourceSide: "bottom",
              targetSide: "top",
              sourceOffset,
              vertices: [
                { x: sourceX, y: laneY },
                { x: targetX, y: laneY },
              ],
              padding: 4,
            },
          );
        }
        groupLayout.group.containers.forEach((record, containerIndex) => {
          if (containerIndex === 0) {
            addEdge(
              graph,
              systemNode,
              containerNodes[containerIndex],
              theme,
              {
                flowing: hasNetworkTraffic(record.net),
                trafficKey: `container-${text(record.id, containerIndex)}`,
                sourceSide: "bottom",
                targetSide: "top",
                padding: 4,
              },
            );
            return;
          }

          const laneX =
            groupLayout.laneStartX + (containerIndex - 1) * EDGE_LANE_GAP;
          const sourceY = groupLayout.systemPosition.y + NODE_HEIGHT / 2;
          const targetY =
            groupLayout.childPositions[containerIndex].y + NODE_HEIGHT / 2;
          addEdge(
            graph,
            systemNode,
            containerNodes[containerIndex],
            theme,
            {
              flowing: hasNetworkTraffic(record.net),
              trafficKey: `container-${text(record.id, containerIndex)}`,
              sourceSide: "right",
              targetSide: "right",
              vertices: [
                { x: laneX, y: sourceY },
                { x: laneX, y: targetY },
              ],
              padding: 4,
            },
          );
        });
      },
    );

    data.rootContainers.forEach((record, index) => {
      if (index === rootCenterIndex) {
        addEdge(
          graph,
          rootNode,
          rootContainerNodes[index],
          theme,
          {
            flowing: hasNetworkTraffic(record.net),
            trafficKey: `container-${text(record.id, index)}`,
            sourceSide: "top",
            targetSide: "bottom",
            padding: 4,
          },
        );
        return;
      }

      const sourceOffset = spreadOffset(
        index,
        data.rootContainers.length,
        170,
      );
      const sourceX =
        contentLeft + contentWidth / 2 + sourceOffset;
      const targetX =
        rootContainerPositions[index].x + SYSTEM_NODE_WIDTH / 2;
      const distanceFromCenter = Math.abs(index - rootCenterIndex);
      const laneY =
        rootY -
        ROOT_EDGE_LANE_MARGIN -
        (rootSideLaneCount - distanceFromCenter) * ROOT_EDGE_LANE_GAP;
      addEdge(
        graph,
        rootNode,
        rootContainerNodes[index],
        theme,
        {
          flowing: hasNetworkTraffic(record.net),
          trafficKey: `container-${text(record.id, index)}`,
          sourceSide: "top",
          targetSide: "bottom",
          sourceOffset,
          vertices: [
            { x: sourceX, y: laneY },
            { x: targetX, y: laneY },
          ],
          padding: 4,
        },
      );
    });

    graph.on("node:click", ({ node }) => {
      const nodeData = node.getData();
      if (nodeData?.type !== "system" || nodeData.record?.virtual) return;
      const id = text(nodeData.record?.id);
      if (id) window.parent.location.href = `/system/${encodeURIComponent(id)}`;
    });

    graph.centerContent();
    graph.zoomToFit({ padding: 36, minScale: 0.45, maxScale: 1 });

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
