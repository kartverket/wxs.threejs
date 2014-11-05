/*jslint indent: 2*/
/*global THREE: false, window: false */
var wxs3 = this.wxs3 || {};

(function (ns) {
  'use strict';


  function join() {
    return Array.prototype.slice.call(arguments).join('_');
  }


  function getTileName(zoom, row, col) {
    return join(zoom, row, col);
  }


  function avg(a, b) {
    return (a + b) / 2;
  }


  function sidesProcessed(tile) {
    var p = tile.geometry.processed;
    return (p.top && p.bottom && p.left && p.right);
  }


  function allSidesProcessed(tile) {
    var p = tile.geometry.processed;
    return (p.topLeft && p.bottomLeft && p.bottomRight && p.topRight);
  }


  function checkTileProcessed(tile) {
    if (sidesProcessed(tile)) {
      tile.geometry.processed.allSides = true;
      if (allSidesProcessed(tile)) {
        tile.geometry.processed.all = true;
      }
    }
  }


  function createQueryParams(params) {
    var list = [];
    var key;
    for (key in params) {
      if (params.hasOwnProperty(key)) {
        list.push(key + '=' + params[key]);
      }
    }
    return list.join('&');
  }


  function getNeighbourNames(zoom, tileRow, tileCol) {
    var row;
    var col;
    var i = 0;
    var pos = [
      'topLeft', 'top', 'topRight',
      'left', null, 'right',
      'bottomLeft', 'bottom', 'bottomRight',
    ];
    var name;
    var neighbours = {};
    for (row = -1; row <= 1; row++) {
      for (col = -1; col <= 1; col++) {
        name = pos[i];
        if (name) {
          neighbours[name] = getTileName(zoom, tileRow + row, tileCol + col);
        }
        i++;
      }
    }
    return neighbours;
  }


  function createWmtsUrl(dim, matrix, tileRow, tileCol) {
    return dim.wmtsUrl + '?' + createQueryParams({
      REQUEST: 'GetTile',
      SERVICE: 'WMTS',
      VERSION: '1.0.0',
      Style: 'default',
      Format: 'image/png',
      Layer: dim.wmtsLayer,
      TileMatrixSet: matrix.TileMatrixSetIdentifier,
      TileMatrix: matrix.Identifier,
      TileRow: tileRow,
      TileCol: tileCol
    });
  }


  function createCacheWmsUrl(dim, activeMatrix, wmsBounds) {
    return dim.wmscUrl + '?' + createQueryParams({
      REQUEST: 'GetMap',
      SERVICE: 'WMS',
      VERSION: '1.3.0',
      Layer: 'topo2',
      Style: 'default',
      Format: 'image/png',
      width: 256,
      height: 256,
      crs: 'EPSG:' + activeMatrix.Identifier.split(':')[1],
      BBOX: wmsBounds.join(',')
    });
  }


  function createWmsUrl(dim, activeMatrix, wmsBounds) {
    return dim.wmsUrl + '?' + createQueryParams({
      GKT: dim.gatekeeperTicket,
      REQUEST: 'GetMap',
      SERVICE: 'WMS',
      VERSION: '1.1.1',
      Layers: dim.wmsLayers,
      Style: 'default',
      Format: 'image/jpeg',
      WIDTH: 256,
      HEIGHT: 256,
      SRS: 'EPSG:' + activeMatrix.Identifier.split(':')[1],
      BBOX: wmsBounds.join(',')
    });
  }


  /*
  function createWcs111Url(dim, wcsBounds) {
    //wcs 1.1.0 NOT WORKING with XYZ - needs to drop xml-part to use tiff-js?
    //'http://wcs.geonorge.no/skwms1/wcs.dtm?SERVICE=WCS&VERSION=1.1.0&REQUEST=GetCoverage&FORMAT=geotiff&IDENTIFIER=all_50m&BOUNDINGBOX='+ wcsBounds.join(',')  +',urn:ogc:def:crs:EPSG::'+activeMatrix.Identifier.split(':')[1] + '&GridBaseCRS=urn:ogc:def:crs:EPSG::'+activeMatrix.Identifier.split(':')[1] + '&GridCS=urn:ogc:def:crs:EPSG::'+activeMatrix.Identifier.split(':')[1] + '&GridType=urn:ogc:def:method:WCS:1.1:2dGridIn2dCrs&GridOrigin=' +wmsBounds[0] +',' +wmsBounds[1] +'&GridOffsets='+grid2rasterUnitsX +',' +grid2rasterUnitsY + '&RangeSubset=50m:average' //[bands[1]]'
  }
  */


  function createWcsUrl(dim, wcsBounds) {
    return dim.wcsUrl + '?' + createQueryParams({
      SERVICE: 'WCS',
      VERSION: '1.0.0',
      REQUEST: 'GetCoverage',
      FORMAT: 'geotiff',
      WIDTH: parseInt(dim.demWidth, 10),
      HEIGHT: parseInt(dim.demWidth, 10),
      COVERAGE: dim.coverage,
      crs: 'EPSG:' + dim.crs,
      BBOX: wcsBounds.join(',') //,
      //INTERPOLATION: 'BILINEAR',
      //RESPONSE_CRS: 'EPSG:' + activeMatrix.Identifier.split(':')[1],
      //RangeSubset='50m',
      //RESX: grid2rasterUnitsX,
      //RESY: grid2rasterUnitsY
    });
  }


  function createWmsBounds(activeMatrix, tileCol, tileRow) {
    var topLeft = activeMatrix.TopLeftCorner;
    return [
      topLeft.minx + (tileCol * activeMatrix.TileSpanX),
      topLeft.maxy - ((tileRow + 1) * activeMatrix.TileSpanY),
      topLeft.minx + ((tileCol + 1) * activeMatrix.TileSpanX),
      topLeft.maxy - (tileRow * activeMatrix.TileSpanY)
    ];
  }


  function createWcsBounds(dim, tileSpanX, tileSpanY, wmsBounds) {
    var wcsDivisor = 2;
    var grid2rasterUnitsX = ((tileSpanX / (dim.demHeight - 1)));
    var grid2rasterUnitsY = ((tileSpanY / (dim.demWidth - 1)));
    return [
      // Add some to the extents as we need to put values from a raster onto a grid. Bazingah!
      (wmsBounds[0] - (grid2rasterUnitsX / wcsDivisor)), //minx
      (wmsBounds[1] - (grid2rasterUnitsY / wcsDivisor)), //miny
      (wmsBounds[2] + (grid2rasterUnitsX / wcsDivisor)), //maxx
      (wmsBounds[3] + (grid2rasterUnitsY / wcsDivisor)) //maxy
    ];
  }


  ns.ThreeDMap = function (layers, dim) {
    var i, length;
    this.dim = dim;
    this.camera = null;
    this.scene = null;
    this.renderer = null;
    this.controls = null;
    this.foregroundMatrix = null;
    this.backgroundMatrix = null;
    this.backgroundTiles = [];
    this.foregroundTiles = [];
    this.foregroundTilesIndex = [];

    // Setting demWidth and demHeight to some fraction of 256
    // TODO: Figure out why tiff-js won't allow arrays longer than 2048
    dim.demWidth = 32;
    dim.demHeight = dim.demWidth;

    // Lets make some indexes over vertice-positions corresponding to edges and corners
    this.edges = {
      top: [],
      left: [],
      right: [],
      bottom: [],
      topLeft: [],
      bottomLeft: [],
      topRight: [],
      bottomRight: []
    };
    length = dim.demWidth * dim.demHeight;
    for (i = 0; i < length; i++) {
      if (i < this.dim.demWidth) {
        this.edges.top.push(i);
        if (i === 0) {
          this.edges.left.push(i);
        } else if (i === this.dim.demWidth - 1) {
          this.edges.right.push(i);
        }
      } else if (i >= length - this.dim.demWidth) {
        this.edges.bottom.push(i);
        if (i === length - this.dim.demWidth) {
          this.edges.left.push(i);
        } else if (i === length - 1) {
          this.edges.right.push(i);
        }
      } else if (i % this.dim.demWidth === 0) {
        this.edges.left.push(i);
      } else if ((i + 1) % this.dim.demWidth === 0) {
        this.edges.right.push(i);
      }
    }

    this.edges.topLeft = this.edges.top[0];
    this.edges.topRight = this.edges.right[0];
    this.edges.bottomLeft = this.edges.bottom[0];
    this.edges.bottomRight = this.edges.bottom[this.dim.demWidth - 1];

    this.dim.wmsLayers = layers;
    this.createRenderer();
    this.createScene();
    this.createCamera();
    this.createControls();
    this.foregroundGroup = new THREE.Object3D();
    this.backgroundGroup = new THREE.Object3D();
    this.foregroundGroup.scale.z = dim.zMult;
    this.scene.add(this.foregroundGroup);
    this.scene.add(this.backgroundGroup);

    // Generate tiles and boundingboxes
    this.generateTiles();
    document.getElementById('webgl').appendChild(this.renderer.domElement);
    this.render();
  };

  ns.ThreeDMap.prototype.createRenderer = function () {
    this.renderer = new THREE.WebGLRenderer({
      //antialias: true
    });
    this.renderer.setSize(this.dim.width, this.dim.height);
  };

  ns.ThreeDMap.prototype.createScene = function () {
    this.scene = new THREE.Scene();
    this.scene.add(new THREE.AmbientLight(0xeeeeee));
  };

  ns.ThreeDMap.prototype.createCamera = function () {
    var centerY, centerX, cameraHeight;
    var fov = 45; // magic number
    this.camera = new THREE.PerspectiveCamera(
      fov,
      this.dim.width / this.dim.height,
      0.1, // magic number
      5000000 // magic number
    );
    // Some trig to find height for camera
    if (!!this.dim.Z) {
      cameraHeight = this.dim.Z;
    } else {
      cameraHeight = (this.dim.metersHeight / 2) / Math.tan((fov / 2) * Math.PI / 180);
    }
    // Place camera in middle of bbox
    centerX = avg(this.dim.minx, this.dim.maxx);
    centerY = avg(this.dim.miny, this.dim.maxy);
    this.camera.position.set(centerX, centerY, cameraHeight);
    this.raycaster = new THREE.Raycaster(this.camera.position, this.vector);
  };

  ns.ThreeDMap.prototype.createControls = function () {
    var centerY;
    var centerX;
    this.controls = new THREE.TrackballControls(this.camera);
    // Point camera directly down
    centerX = avg(this.dim.minx, this.dim.maxx);
    centerY = avg(this.dim.miny, this.dim.maxy);
    this.controls.target = new THREE.Vector3(centerX, centerY, 0);
  };

  ns.ThreeDMap.prototype.render = function () {
    var i;
    var child;
    for (i = 0; i < this.foregroundGroup.children.length; i++) {
      child = this.foregroundGroup.children[i];
      if (child.scale.z < 1 && child.geometry.loaded === true) {
        child.scale.z += 0.02;
      } else if (child.scale.z >= 1) {
        //child.material.wireframe=false;
        if (child.geometry.processed.all === false) {
          this.neighbourTest(child.WMTSCall);
        }
      }
    }
    this.controls.update();
    window.requestAnimationFrame(this.render.bind(this));
    this.renderer.render(this.scene, this.camera);
    this.caster();
  };

  ns.ThreeDMap.prototype.generateTiles = function () {
    var capabilitiesURL = this.dim.wmtsUrl + '?' + createQueryParams({
      Version: '1.0.0',
      service: 'WMTS',
      request: 'getCapabilities'
    });
    var WMTSCapabilities = new ns.WMTS(
      capabilitiesURL,
      this.dim.crs,
      this.dim.wmtsLayer
    );
    var that = this;
    WMTSCapabilities.fetchCapabilities(function (tileMatrixSet) {
      that.bbox2tiles(tileMatrixSet);
    });
  };

  ns.ThreeDMap.prototype.bbox2tiles = function (tileMatrixSet) {
    var i, tmpBounds, tileMatrix, spanDivisor, tileMatrixCount;
    var bounds = this.dim.getBounds();
    var WMTSCalls = [];
    var querySpanX = bounds.maxx - bounds.minx;
    var querySpanY = bounds.maxy - bounds.miny;
    var querySpanMin, querySpanMinDim; //, querySpanMax, querySpanMaxDim;

    if (querySpanX > querySpanY) {
      querySpanMin = querySpanY;
      //querySpanMax = querySpanX;
      querySpanMinDim = 'y';
      //querySpanMaxDim = 'x';
    } else {
      querySpanMin = querySpanX;
      //querySpanMax = querySpanY;
      querySpanMinDim = 'x';
      //querySpanMaxDim = 'y';
    }
    tileMatrixCount = tileMatrixSet.length;

    /*
    Here we find the first matrix that has a tilespan smaller than that of
    the smallest dimension of the input bbox.
    We can control the resolution of the images by altering how large a
    difference there must be (half, quarter etc.)
    */
    spanDivisor = 4;
    var obj;
    for (tileMatrix = 0; tileMatrix < tileMatrixCount; tileMatrix++) {
      obj = tileMatrixSet[tileMatrix];
      if (querySpanMinDim === 'x') {
        if (obj.TileSpanX < querySpanMin / spanDivisor) {
          this.foregroundMatrix = obj;
          this.backgroundMatrix = tileMatrixSet[tileMatrix - 1];
          break;
        }
      } else if (obj.TileSpanY < querySpanMin / spanDivisor) {
        this.foregroundMatrix = obj;
        this.backgroundMatrix = tileMatrixSet[tileMatrix - 1];
        break;
      }
    }
    tmpBounds = new THREE.Vector2(
      avg(bounds.maxx, bounds.minx),
      avg(bounds.maxy, bounds.miny)
    );
    WMTSCalls = this.centralTileFetcher(tmpBounds, this.backgroundMatrix);
    this.tileLoader(WMTSCalls, false);
    for (i = 0; i < WMTSCalls.length; i++) {
      this.mainTileLoader({
        zoom: WMTSCalls[i].zoom,
        tileRow: WMTSCalls[i].tileRow,
        tileCol: WMTSCalls[i].tileCol
      });
    }
  };

  ns.ThreeDMap.prototype.createWMTSCalls = function (group, matrix, tileCol, tileRow) {
    var tr, tc;
    var WMTSCalls = [];
    var name = null;
    var tileColMin = tileCol - 1;
    var tileRowMin = tileRow - 1;
    var tileColMax = tileCol + 1;
    var tileRowMax = tileRow + 1;
    // Here we generate tileColumns and tileRows as well as
    // translate tilecol and tilerow to boundingboxes
    for (tc = tileColMin; tc <= tileColMax; tc++) {
      for (tr = tileRowMin; tr <= tileRowMax; tr++) {
        name = getTileName(matrix.Zoom, tr, tc);
        if (group.indexOf(name) === -1) {
          group.push(name);
          WMTSCalls.push(this.singleTileFetcher(tc, tr, matrix));
        }
      }
    }
    return WMTSCalls;
  };

  ns.ThreeDMap.prototype.centralTileFetcher = function (bounds, activeMatrix) {
    var tileCol = Math.floor((bounds.x - activeMatrix.TopLeftCorner.minx) / activeMatrix.TileSpanX);
    var tileRow = Math.floor((activeMatrix.TopLeftCorner.maxy - bounds.y) / activeMatrix.TileSpanY);
    return this.createWMTSCalls(
      this.backgroundTiles,
      activeMatrix,
      tileCol,
      tileRow
    );
  };

  ns.ThreeDMap.prototype.tileChildren = function (tileName) {
    var tileCol = tileName.tileCol * 2;
    var tileRow = tileName.tileRow * 2;
    return this.createWMTSCalls(
      this.foregroundTiles,
      this.foregroundMatrix,
      tileCol,
      tileRow
    );
  };

  ns.ThreeDMap.prototype.singleTileFetcher = function (tileCol, tileRow, activeMatrix) {
    var tileSpanY = activeMatrix.TileSpanY;
    var tileSpanX = activeMatrix.TileSpanX;
    var wmsBounds = createWmsBounds(activeMatrix, tileCol, tileRow);
    var wcsBounds = createWcsBounds(this.dim, tileSpanX, tileSpanY, wmsBounds);
    return {
      tileSpanX: tileSpanX,
      tileSpanY: tileSpanY,
      tileRow: tileRow,
      tileCol: tileCol,
      zoom: activeMatrix.Zoom,
      neighbours: getNeighbourNames(activeMatrix.Zoom, tileRow, tileCol),
      // Setting these for easy debugging
      // TODO: define parameters here for reuse later on
      url: {
        cache_WMTS: createWmtsUrl(this.dim, activeMatrix, tileRow, tileCol),
        cache_wms: createCacheWmsUrl(this.dim, activeMatrix, wmsBounds),
        wms: createWmsUrl(this.dim, activeMatrix, wmsBounds),
        //wcs 1.1.0 NOT WORKING with XYZ - needs to drop xml-part to use tiff-js?
        //wcs: createWcs111Url(this.dim, wcsBounds)
        wcs: createWcsUrl(this.dim, wcsBounds)
      },
      bounds: {
        minx: wmsBounds[0],
        miny: wmsBounds[1],
        maxx: wmsBounds[2],
        maxy: wmsBounds[3]
      }
    };
  };

  ns.ThreeDMap.prototype.caster = function () {
    this.vector = new THREE.Vector3(0, 0, -1);
    this.vector.applyQuaternion(this.camera.quaternion);
    this.raycaster = new THREE.Raycaster(this.camera.position, this.vector);
    this.intersects = this.raycaster.intersectObjects(
      this.backgroundGroup.children
    );
    if (this.intersects.length > 0) {
      var tileName = this.intersects[0].object.tileName;
      this.mainTileLoader(tileName);
    }
  };

  ns.ThreeDMap.prototype.mainTileLoader = function (tileName) {
    var neighbourCall;
    var neighbourCalls = this.backGroundTileNeighbours(tileName);
    // add foreground
    var children = this.tileChildren(tileName);
    this.tileLoader(children, true);
    // add backgound
    for (neighbourCall = 0; neighbourCall < neighbourCalls.length; neighbourCall++) {
      this.tileLoader([ neighbourCalls[neighbourCall] ], false);
    }
    // remove processed background
    // TODO: Find out if we need to run geometry.dispose() first.
    var obj = this.backgroundGroup.getObjectByName(
      getTileName(tileName.zoom, tileName.tileRow, tileName.tileCol)
    );
    obj.geometry.dispose();
    this.backgroundGroup.remove(obj);
  };

  ns.ThreeDMap.prototype.backGroundTileNeighbours = function (tileName) {
    var tr, tc;
    var WMTSCalls = [];
    var tileCol = tileName.tileCol;
    var tileRow = tileName.tileRow;
    var tileColMin = tileCol - 1;
    var tileRowMin = tileRow - 1;
    var tileColMax = tileCol + 1;
    var tileRowMax = tileRow + 1;
    // Here we generate tileColumns and tileRows as well as  translate tilecol and tilerow to boundingboxes
    for (tc = tileColMin; tc <= tileColMax; tc++) {
      for (tr = tileRowMin; tr <= tileRowMax; tr++) {
      // TODO: Why do we still use this instead of backgroundGroup.getObjectByName()
        if (this.backgroundTiles.indexOf(getTileName(tileName.zoom, tr, tc)) === -1) {
          this.backgroundTiles.push(getTileName(tileName.zoom, tr, tc));
          WMTSCalls.push(this.singleTileFetcher(tc, tr, this.backgroundMatrix));
        }
      }
    }
    return WMTSCalls;
  };

  ns.ThreeDMap.prototype.tileLoader = function (WMTSCalls, visible) {
    var WCSTile, concatName, geometry, material, i;
    var activeUrl;
    var wmtsCall;
    for (i = 0; i < WMTSCalls.length; i++) {
      wmtsCall = WMTSCalls[i];
      material = null;
      geometry = null;
      concatName = getTileName(wmtsCall.zoom, wmtsCall.tileRow, wmtsCall.tileCol);
      if (visible) {
        // Hack for CORS?
        THREE.ImageUtils.crossOrigin = "";

        WCSTile = new ns.WCS(
          wmtsCall.tileSpanX,
          wmtsCall.tileSpanY,
          this.dim.demWidth - 1,
          this.dim.demHeight - 1
        );
        WCSTile.wcsFetcher(wmtsCall);
        geometry = WCSTile.geometry;
        geometry.processed = {
          left: false,
          right: false,
          top: false,
          bottom: false,
          topLeft: false,
          topRight: false,
          bottomLeft: false,
          bottomRight: false,
          allSides: false,
          all: false
        };

        if (this.dim.wmsUrl) {
          activeUrl = wmtsCall.url.wms;
        } else {
          activeUrl = wmtsCall.url.cache_WMTS;
        }
        // TODO: Create a loader for images based on the WCS-loader.
        //This allows us to check if the image actually loads and reload
        //if something fails. Also, we can use wireframes as a placeholder.
        material = new THREE.MeshBasicMaterial(
          {

            map: THREE.ImageUtils.loadTexture(
              activeUrl,
              new THREE.UVMapping()
            ),

            //side: THREE.DoubleSide
            //wireframe: true
          }
        );
        //material.depthWrite=false;
        //material.map.image.hidden=true;
      } else {
        geometry = new THREE.PlaneGeometry(wmtsCall.tileSpanX, wmtsCall.tileSpanY);
        material = new THREE.MeshBasicMaterial({color: 0xff0000, wireframe: true});
      }
      this.mesh = new THREE.Mesh(
        geometry,
        material
      );
      this.mesh.position.x = wmtsCall.bounds.minx + (wmtsCall.tileSpanX / 2);
      this.mesh.position.y = wmtsCall.bounds.miny + (wmtsCall.tileSpanY / 2);
      this.mesh.tileName = {
        zoom: wmtsCall.zoom,
        tileRow: wmtsCall.tileRow,
        tileCol: wmtsCall.tileCol
      };
      this.mesh.name = concatName;
      this.mesh.bounds = wmtsCall.bounds;
      this.mesh.url = wmtsCall.url;
      this.mesh.scale.z = 0.02;
      this.mesh.WMTSCall = wmtsCall;
      this.tileLoaded(this.mesh, visible);
    }
  };

  ns.ThreeDMap.prototype.tileLoaded = function (tile, visible) {
    tile.visible = visible;
    if (visible) {
      this.foregroundGroup.add(tile);
    } else {
      this.backgroundGroup.add(tile);
    }
  };

  ns.ThreeDMap.prototype.testTile = function (tile, neighbours, side) {
    if (!tile.geometry.processed[side]) {
      this.geometryEdgeTester(tile, neighbours[side], side);
    }
  };

  ns.ThreeDMap.prototype.neighbourTest = function (WMTSCall) {
    var name = getTileName(WMTSCall.zoom, WMTSCall.tileRow, WMTSCall.tileCol);
    var neighbours = WMTSCall.neighbours;

    var tile = this.foregroundGroup.getObjectByName(name);
    // If the tile is already processed on edges we skip
    if (!tile.geometry.processed.allSides) {
      this.testTile(tile, neighbours, 'top');
      this.testTile(tile, neighbours, 'bottom');
      this.testTile(tile, neighbours, 'left');
      this.testTile(tile, neighbours, 'right');
    } else { // Test if neighbours are loaded
      if (!tile.geometry.processed.topLeft) {
        this.geometryCornerTester(
          tile,
          neighbours,
          ['topLeft', 'left', 'top']
        );
      }
      if (!tile.geometry.processed.bottomLeft) {
        this.geometryCornerTester(
          tile,
          neighbours,
          ['bottomLeft', 'left', 'bottom']
        );
      }
      if (!tile.geometry.processed.bottomRight) {
        this.geometryCornerTester(
          tile,
          neighbours,
          ['bottomRight', 'right', 'bottom']
        );
      }
      if (!tile.geometry.processed.topRight) {
        this.geometryCornerTester(
          tile,
          neighbours,
          ['topRight', 'right', 'top']
        );
      }
    }
  };

  ns.ThreeDMap.prototype.geometryEdgeTester = function (tile, neighbourName, placement) {
    var neighbour = this.foregroundGroup.getObjectByName(neighbourName);
    if (!neighbour) {
      return;
    }
    if (neighbour.geometry.loaded && neighbour.scale.z >= 1 && tile.geometry.loaded) {
      this.geometryEdgeFixer(tile, neighbour, placement);
    }
  };

  ns.ThreeDMap.prototype.geometryEdgeFixer = function (tile, neighbour, placement) {
    // Edges
    var oppositeEdge = {
      top: 'bottom',
      bottom: 'top',
      left: 'right',
      right: 'left',
      topLeft: 'bottomRight',
      bottomRight: 'topLeft',
      topRight: 'bottomLeft',
      bottomLeft: 'topRight'
    };

    var i;
    for (i = 0; i < this.edges[placement].length; i++) {
      tile.geometry.vertices[this.edges[placement][i]].z = (tile.geometry.vertices[this.edges[placement][i]].z + neighbour.geometry.vertices[this.edges[oppositeEdge[placement]][i]].z) / 2;
      neighbour.geometry.vertices[this.edges[oppositeEdge[placement]][i]].z = tile.geometry.vertices[this.edges[placement][i]].z;
    }
    tile.geometry.verticesNeedUpdate = true;
    neighbour.geometry.verticesNeedUpdate = true;
    tile.geometry.processed[placement] = true;
    neighbour.geometry.processed[oppositeEdge[placement]] = true;

    checkTileProcessed(tile);
    checkTileProcessed(neighbour);
  };


  ns.ThreeDMap.prototype.geometryCornerTester = function (tile, orgNeighbours, placements) {
    if (!tile.geometry.loaded) {
      return;
    }

    var neighbours = [];
    var neighbour;
    var i;
    var key;
    for (i in placements) {
      if (placements.hasOwnProperty(i)) {
        key = placements[i];
        neighbour = this.foregroundGroup.getObjectByName(orgNeighbours[key]);
        if (neighbour && neighbour.geometry.loaded && neighbour.scale.z >= 1) {
          neighbours.push(neighbour);
        }
      }
    }
    // Check to see if we have all neighbours
    if (neighbours.length === 3) {
      this.geometryCornerFixer(tile, neighbours, placements);
    }
  };

  ns.ThreeDMap.prototype.geometryCornerFixer = function (tile, neighbours, placements) {
    // Index to invert corners
    // TODO: This is not very easy to read. Might need a better solution
    // TODO: This is constant and should be defined only once
    var oppositeCorners = {
      topLeft: {
        topLeft: 'bottomRight',
        left: 'topRight',
        top: 'bottomLeft'
      },
      bottomRight: {
        bottomRight: 'topLeft',
        right: 'bottomLeft',
        bottom: 'topRight'
      },
      topRight: {
        topRight: 'bottomLeft',
        right: 'topLeft',
        top: 'bottomRight'
      },
      bottomLeft: {
        bottomLeft: 'topRight',
        left: 'bottomRight',
        bottom: 'topLeft'
      }
    };

    // Calculate average height
    var averageHeightCorner =
      (
        tile.geometry.vertices[this.edges[placements[0]]].z +
        neighbours[0].geometry.vertices[this.edges[
            oppositeCorners[placements[0]][placements[0]]
          ]].z +
        neighbours[1].geometry.vertices[this.edges[
            oppositeCorners[placements[0]][placements[1]]
          ]].z +
        neighbours[2].geometry.vertices[this.edges[
            oppositeCorners[placements[0]][placements[2]]
          ]].z
      ) / 4;

    // Set vertex on tile and neighbours to average value
    tile.geometry.vertices[this.edges[placements[0]]].z = averageHeightCorner;
    neighbours[0].geometry.vertices[this.edges[
      oppositeCorners[placements[0]][placements[0]]
    ]].z = averageHeightCorner;
    neighbours[1].geometry.vertices[this.edges[
      oppositeCorners[placements[0]][placements[1]]
    ]].z = averageHeightCorner;
    neighbours[2].geometry.vertices[this.edges[
      oppositeCorners[placements[0]][placements[2]]
    ]].z = averageHeightCorner;

    // Flag for update
    tile.geometry.verticesNeedUpdate = true;
    neighbours[0].geometry.verticesNeedUpdate = true;
    neighbours[1].geometry.verticesNeedUpdate = true;
    neighbours[2].geometry.verticesNeedUpdate = true;

    // Flag corners as processed
    tile.geometry.processed[placements[0]] = true;
    neighbours[0].geometry.processed[oppositeCorners[placements[0]][placements[0]]] = true;
    neighbours[1].geometry.processed[oppositeCorners[placements[0]][placements[1]]] = true;
    neighbours[2].geometry.processed[oppositeCorners[placements[0]][placements[2]]] = true;

    // Check if all corners are averaged and flag if so
    if (allSidesProcessed(tile)) {
      tile.geometry.processed.all = true;
      var i;
      for (i = 0; i < 3; i++) {
        if (allSidesProcessed(neighbours[i])) {
          neighbours[i].geometry.processed.all = true;
        }
      }
    }
  };
}(wxs3));
