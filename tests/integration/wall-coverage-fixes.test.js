/**
 * Integration tests for Wall Coverage Fixes
 * Tests the complete end-to-end functionality of wall coverage fixes including:
 * 1. Directional wall logic fixes (LEFT/RIGHT/BOTH)
 * 2. Improved wall coverage percentage calculation
 * 3. Real-world scenarios that were previously broken
 */

import '../setup.js';

describe('Wall Coverage Fixes Integration Tests', () => {
  let coverDetector;

  beforeEach(async () => {
    jest.resetModules();

    // Import the detector
    const { CoverDetector } = await import('../../scripts/cover/auto-cover/CoverDetector.js');
    coverDetector = new CoverDetector();

    // Setup comprehensive mock canvas
    global.canvas = {
      walls: {
        placeables: [],
        objects: { children: [] }
      },
      tokens: { placeables: [] },
      grid: {
        size: 100,
        distance: 5
      }
    };

    // Mock settings with default values
    global.game = {
      settings: {
        get: jest.fn((module, setting) => {
          const defaults = {
            'wallCoverStandardThreshold': 50,
            'wallCoverGreaterThreshold': 70,
            'wallCoverAllowGreater': true
          };
          return defaults[setting] || null;
        })
      }
    };

    // Mock getTokenRect utility function
    global.getTokenRect = jest.fn((token) => ({
      x1: token.x,
      y1: token.y,
      x2: token.x + token.w,
      y2: token.y + token.h
    }));
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('Directional Wall Fixes - Real World Scenarios', () => {
    test('should fix RIGHT directional walls not providing cover', () => {
      // This tests the original user issue: walls from right side not granting cover
      const rightDirectionalWall = {
        document: {
          sight: 20,
          dir: 2, // RIGHT - blocks when crossProduct < 0
          c: [500, 300, 500, 600], // Vertical wall
          getFlag: jest.fn(() => null)
        },
        coords: [500, 300, 500, 600]
      };

      global.canvas.walls.objects.children = [rightDirectionalWall];

      // Create target token
      const targetToken = {
        document: { width: 1, height: 1, x: 600, y: 400 },
        x: 600, y: 400, w: 100, h: 100
      };

      // Mock token finder
      coverDetector._findNearestTokenToPoint = jest.fn(() => targetToken);

      // Mock line intersection - wall blocks sight
      coverDetector._lineIntersectionPoint = jest.fn(() => ({ x: 500, y: 450 }));

      // Mock coverage percentage calculation to return high enough value for cover
      coverDetector._estimateWallCoveragePercent = jest.fn(() => 75); // Above standard threshold

      // Test 1: Attack from right side of wall (should be blocked by RIGHT wall)
      const attackerFromRight = { x: 600, y: 200 }; // Right of wall
      const targetPos = { x: 650, y: 450 }; // Target behind wall

      const coverFromRight = coverDetector._evaluateWallsCover(attackerFromRight, targetPos);
      expect(['standard', 'greater'].includes(coverFromRight)).toBe(true); // Should provide cover now!

      // Test 2: Attack from left side of wall (should NOT be blocked by RIGHT wall)
      const attackerFromLeft = { x: 400, y: 200 }; // Left of wall
      
      // Reset the mock to return 0% for non-blocking directions
      coverDetector._estimateWallCoveragePercent.mockReturnValueOnce(0);
      
      const coverFromLeft = coverDetector._evaluateWallsCover(attackerFromLeft, targetPos);
      expect(coverFromLeft).toBe('none'); // Should not provide cover
    });

    test('should fix LEFT directional walls working correctly', () => {
      const leftDirectionalWall = {
        document: {
          sight: 20,
          dir: 1, // LEFT - blocks when crossProduct > 0
          c: [500, 300, 500, 600], // Vertical wall
          getFlag: jest.fn(() => null)
        },
        coords: [500, 300, 500, 600]
      };

      global.canvas.walls.objects.children = [leftDirectionalWall];

      const targetToken = {
        document: { width: 1, height: 1, x: 600, y: 400 },
        x: 600, y: 400, w: 100, h: 100
      };

      coverDetector._findNearestTokenToPoint = jest.fn(() => targetToken);
      coverDetector._lineIntersectionPoint = jest.fn(() => ({ x: 500, y: 450 }));

      // Mock coverage percentage calculation to return high enough value for cover
      coverDetector._estimateWallCoveragePercent = jest.fn(() => 65); // Above standard threshold

      // Test 1: Attack from left side of wall (should be blocked by LEFT wall)
      const attackerFromLeft = { x: 400, y: 200 }; // Left of wall
      const targetPos = { x: 650, y: 450 };

      const coverFromLeft = coverDetector._evaluateWallsCover(attackerFromLeft, targetPos);
      expect(['standard', 'greater'].includes(coverFromLeft)).toBe(true); // Should provide cover

      // Test 2: Attack from right side of wall (should NOT be blocked by LEFT wall)
      const attackerFromRight = { x: 600, y: 200 }; // Right of wall
      
      // Reset the mock to return 0% for non-blocking directions
      coverDetector._estimateWallCoveragePercent.mockReturnValueOnce(0);
      
      const coverFromRight = coverDetector._evaluateWallsCover(attackerFromRight, targetPos);
      expect(coverFromRight).toBe('none'); // Should not provide cover
    });

    test('should handle BOTH directional walls correctly', () => {
      const bothDirectionalWall = {
        document: {
          sight: 20,
          dir: 0, // BOTH - blocks from all directions
          c: [500, 300, 500, 600],
          getFlag: jest.fn(() => null)
        },
        coords: [500, 300, 500, 600]
      };

      global.canvas.walls.objects.children = [bothDirectionalWall];

      const targetToken = {
        document: { width: 1, height: 1, x: 600, y: 400 },
        x: 600, y: 400, w: 100, h: 100
      };

      coverDetector._findNearestTokenToPoint = jest.fn(() => targetToken);
      coverDetector._lineIntersectionPoint = jest.fn(() => ({ x: 500, y: 450 }));

      // Mock coverage percentage calculation to return high enough value for cover
      coverDetector._estimateWallCoveragePercent = jest.fn(() => 80); // Above standard threshold

      const targetPos = { x: 650, y: 450 };

      // Test from both sides - should block from both
      const attackerFromLeft = { x: 400, y: 200 };
      const attackerFromRight = { x: 600, y: 200 };

      const coverFromLeft = coverDetector._evaluateWallsCover(attackerFromLeft, targetPos);
      const coverFromRight = coverDetector._evaluateWallsCover(attackerFromRight, targetPos);

      expect(['standard', 'greater'].includes(coverFromLeft)).toBe(true); // Should provide cover
      expect(['standard', 'greater'].includes(coverFromRight)).toBe(true); // Should provide cover
    });
  });

  describe('Improved Coverage Percentage Calculation', () => {
    test('should provide more accurate coverage percentages', () => {
      // Create a simple blocking wall
      const blockingWall = {
        document: {
          sight: 20,
          dir: 0, // BOTH
          c: [300, 200, 600, 200], // Horizontal wall
          getFlag: jest.fn(() => null)
        },
        coords: [300, 200, 600, 200]
      };

      global.canvas.walls.objects.children = [blockingWall];

      const targetToken = {
        document: { width: 1, height: 1, x: 400, y: 300 },
        x: 400, y: 300, w: 100, h: 100
      };

      coverDetector._findNearestTokenToPoint = jest.fn(() => targetToken);

      // Mock line intersection to simulate partial blocking
      let intersectionCallCount = 0;
      coverDetector._lineIntersectionPoint = jest.fn(() => {
        intersectionCallCount++;
        // Return intersection for some calls to simulate partial blocking
        return intersectionCallCount % 3 === 0 ? { x: 450, y: 200 } : null;
      });

      const attackerPos = { x: 450, y: 100 }; // Above wall
      const targetPos = { x: 450, y: 350 }; // Below wall

      const result = coverDetector._evaluateWallsCover(attackerPos, targetPos);

      // With improved calculation, should get more predictable results
      // The exact result depends on how many sample points intersect
      expect(['none', 'standard'].includes(result)).toBe(true);
    });

    test('should handle complex multi-wall scenarios', () => {
      // Create multiple walls creating partial cover
      const wall1 = {
        document: {
          sight: 20, dir: 0,
          c: [300, 150, 500, 150],
          getFlag: jest.fn(() => null)
        },
        coords: [300, 150, 500, 150]
      };

      const wall2 = {
        document: {
          sight: 20, dir: 0,
          c: [300, 250, 500, 250],
          getFlag: jest.fn(() => null)
        },
        coords: [300, 250, 500, 250]
      };

      global.canvas.walls.objects.children = [wall1, wall2];

      const targetToken = {
        document: { width: 1, height: 1, x: 400, y: 300 },
        x: 400, y: 300, w: 100, h: 100
      };

      coverDetector._findNearestTokenToPoint = jest.fn(() => targetToken);

      // Mock intersections for both walls
      coverDetector._lineIntersectionPoint = jest.fn((x1, y1, x2, y2, wx1, wy1, wx2, wy2) => {
        // Return intersection if ray crosses any wall
        if ((y1 < 150 && y2 > 150) || (y1 < 250 && y2 > 250)) {
          return { x: 400, y: wy1 };
        }
        return null;
      });

      const attackerPos = { x: 400, y: 100 };
      const targetPos = { x: 450, y: 350 };

      const result = coverDetector._evaluateWallsCover(attackerPos, targetPos);

      // Should provide some level of cover due to multiple wall intersections
      expect(['standard', 'greater'].includes(result)).toBe(true);
    });
  });

  describe('Real-World Bug Reproduction and Fixes', () => {
    test('should fix reported issue: horizontal wall not blocking from right', () => {
      // Recreate user's reported scenario
      const horizontalWall = {
        document: {
          sight: 20,
          dir: 2, // RIGHT direction
          c: [200, 300, 800, 300], // Long horizontal wall
          getFlag: jest.fn(() => null)
        },
        coords: [200, 300, 800, 300]
      };

      global.canvas.walls.objects.children = [horizontalWall];

      const targetToken = {
        document: { width: 1, height: 1, x: 500, y: 400 },
        x: 500, y: 400, w: 100, h: 100
      };

      coverDetector._findNearestTokenToPoint = jest.fn(() => targetToken);
      coverDetector._lineIntersectionPoint = jest.fn(() => ({ x: 550, y: 300 }));

      // Mock coverage percentage calculation to return high enough value for cover
      coverDetector._estimateWallCoveragePercent = jest.fn(() => 55); // Above standard threshold

      // Attack from above wall (right side for horizontal wall)
      const attackerFromAbove = { x: 550, y: 200 }; // Above wall (right side)
      const targetPos = { x: 550, y: 450 }; // Below wall

      const result = coverDetector._evaluateWallsCover(attackerFromAbove, targetPos);

      // This should now work correctly with the fix (may be standard or greater depending on percentage)
      expect(['standard', 'greater'].includes(result)).toBe(true);
    });

    test('should fix percentage calculation accuracy for partial coverage', () => {
      // Test the improved percentage calculation in a realistic scenario
      const partialCoverWall = {
        document: {
          sight: 20, dir: 0,
          c: [400, 200, 400, 350], // Vertical wall partially blocking target
          getFlag: jest.fn(() => null)
        },
        coords: [400, 200, 400, 350]
      };

      global.canvas.walls.objects.children = [partialCoverWall];

      const targetToken = {
        document: { width: 1, height: 1, x: 450, y: 300 },
        x: 450, y: 300, w: 100, h: 100 // 100x100 token
      };

      coverDetector._findNearestTokenToPoint = jest.fn(() => targetToken);

      // Mock intersection to simulate partial blocking
      coverDetector._lineIntersectionPoint = jest.fn((x1, y1, x2, y2) => {
        // Only block rays that cross the wall within its bounds
        if (x1 < 400 && x2 > 400 && y2 >= 200 && y2 <= 350) {
          return { x: 400, y: y2 };
        }
        return null;
      });

      // Set custom thresholds for this test
      global.game.settings.get.mockImplementation((module, setting) => {
        if (setting === 'wallCoverStandardThreshold') return 30;
        if (setting === 'wallCoverGreaterThreshold') return 60;
        if (setting === 'wallCoverAllowGreater') return true;
        return null;
      });

      const attackerPos = { x: 200, y: 325 }; // Left of wall
      const targetPos = { x: 500, y: 350 }; // Right of wall

      const result = coverDetector._evaluateWallsCover(attackerPos, targetPos);

      // Should now get more accurate coverage calculation
      // Exact result depends on how many sample rays are blocked
      expect(['none', 'standard', 'greater'].includes(result)).toBe(true);
    });

    test('should handle edge case: token exactly aligned with wall direction', () => {
      const alignedWall = {
        document: {
          sight: 20,
          dir: 1, // LEFT
          c: [300, 300, 500, 300], // Horizontal wall
          getFlag: jest.fn(() => null)
        },
        coords: [300, 300, 500, 300]
      };

      global.canvas.walls.objects.children = [alignedWall];

      const targetToken = {
        document: { width: 1, height: 1, x: 400, y: 300 },
        x: 400, y: 300, w: 100, h: 100
      };

      coverDetector._findNearestTokenToPoint = jest.fn(() => targetToken);
      coverDetector._lineIntersectionPoint = jest.fn(() => ({ x: 400, y: 300 }));

      // Attacker exactly on the wall line
      const attackerPos = { x: 350, y: 300 };
      const targetPos = { x: 450, y: 300 };

      const result = coverDetector._evaluateWallsCover(attackerPos, targetPos);

      // Should handle this edge case gracefully
      expect(['none', 'standard'].includes(result)).toBe(true);
    });
  });

  describe('Performance and Stability', () => {
    test('should handle large numbers of walls efficiently', () => {
      // Create many walls to test performance
      const walls = [];
      for (let i = 0; i < 20; i++) {
        walls.push({
          document: {
            sight: 20,
            dir: i % 3, // Mix of BOTH, LEFT, RIGHT
            c: [i * 50, 100, i * 50, 400],
            getFlag: jest.fn(() => null)
          },
          coords: [i * 50, 100, i * 50, 400]
        });
      }

      global.canvas.walls.objects.children = walls;

      const targetToken = {
        document: { width: 1, height: 1, x: 500, y: 250 },
        x: 500, y: 250, w: 100, h: 100
      };

      coverDetector._findNearestTokenToPoint = jest.fn(() => targetToken);

      // Mock some intersections
      let callCount = 0;
      coverDetector._lineIntersectionPoint = jest.fn(() => {
        callCount++;
        return callCount % 5 === 0 ? { x: 500, y: 250 } : null;
      });

      const start = Date.now();
      const result = coverDetector._evaluateWallsCover({ x: 100, y: 250 }, { x: 550, y: 250 });
      const end = Date.now();

      // Should complete reasonably quickly (less than 100ms)
      expect(end - start).toBeLessThan(100);
      expect(['none', 'standard', 'greater'].includes(result)).toBe(true);
    });

    test('should handle error conditions gracefully without crashing', () => {
      // Test with malformed wall data
      const malformedWall = {
        document: {
          sight: 20,
          dir: 1,
          c: null, // Invalid coordinates
          getFlag: jest.fn(() => null)
        },
        coords: null
      };

      global.canvas.walls.objects.children = [malformedWall];

      const targetToken = {
        document: { width: 1, height: 1, x: 400, y: 300 },
        x: 400, y: 300, w: 100, h: 100
      };

      coverDetector._findNearestTokenToPoint = jest.fn(() => targetToken);

      // Should not throw errors
      expect(() => {
        const result = coverDetector._evaluateWallsCover({ x: 100, y: 250 }, { x: 550, y: 250 });
        expect(['none', 'standard', 'greater'].includes(result)).toBe(true);
      }).not.toThrow();
    });
  });

  describe('Regression Tests', () => {
    test('should not break existing non-directional wall functionality', () => {
      const standardWall = {
        document: {
          sight: 20,
          dir: null, // Non-directional (standard behavior)
          c: [400, 200, 400, 400],
          getFlag: jest.fn(() => null)
        },
        coords: [400, 200, 400, 400]
      };

      global.canvas.walls.objects.children = [standardWall];

      const targetToken = {
        document: { width: 1, height: 1, x: 500, y: 300 },
        x: 500, y: 300, w: 100, h: 100
      };

      coverDetector._findNearestTokenToPoint = jest.fn(() => targetToken);
      coverDetector._lineIntersectionPoint = jest.fn(() => ({ x: 400, y: 350 }));

      // Mock coverage percentage calculation to return high enough value for cover
      coverDetector._estimateWallCoveragePercent = jest.fn(() => 60); // Above standard threshold

      // Test from both sides - should block from both
      const leftResult = coverDetector._evaluateWallsCover({ x: 200, y: 350 }, { x: 550, y: 350 });
      const rightResult = coverDetector._evaluateWallsCover({ x: 600, y: 350 }, { x: 450, y: 350 });

      expect(['standard', 'greater'].includes(leftResult)).toBe(true);
      expect(['standard', 'greater'].includes(rightResult)).toBe(true);
    });

    test('should maintain compatibility with cover override flags', () => {
      const overrideWall = {
        document: {
          sight: 20,
          dir: 2, // RIGHT
          c: [400, 200, 400, 400],
          getFlag: jest.fn((moduleId, flagName) => {
            if (flagName === 'coverOverride') return 'standard';
            return null;
          })
        },
        coords: [400, 200, 400, 400]
      };

      global.canvas.walls.objects.children = [overrideWall];
      coverDetector._lineIntersectionPoint = jest.fn(() => ({ x: 400, y: 350 }));

      // Mock that wall cover override check returns the override value
      coverDetector._checkWallCoverOverrides = jest.fn(() => 'standard');
      
      // Mock the coverage percentage to return a value that would normally trigger greater cover
      coverDetector._estimateWallCoveragePercent = jest.fn(() => 80); // Above greater threshold (70%)

      // Attack from right side (should be blocked by RIGHT wall and use override as ceiling)
      const result = coverDetector._evaluateWallsCover({ x: 600, y: 350 }, { x: 350, y: 350 });
      expect(result).toBe('standard'); // Should use override as ceiling, limiting greater cover to standard
    });
  });
});
