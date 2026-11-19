import { AdditiveBlending, BufferAttribute, BufferGeometry, DynamicDrawUsage, Points, PointsMaterial } from 'three';
import type { DrawablePerson } from '../shared/track-motion';
import { TRACK_COLORS, trackColorRole, type TrackColorRole } from '../shared/track-colors';
import { HUMAN_POINT_COUNT, createHumanTemplates, templateIndexForTrackId, type HumanTemplate } from './human-template';
import { pointIntensityForRole, type Rgb } from './point-cloud-colors';

/** More people than the platform ever holds; anyone past this is not drawn. */
export const MAX_PEOPLE = 220;
const TEMPLATE_SEED = 1717;

/**
 * Overlapping points add up under additive blending, so a tight group would clip to white.
 * Each neighbour within this radius dims a person a little, down to a floor.
 */
const NEIGHBOUR_RADIUS_METRES = 1.1;
const DIMMING_PER_NEIGHBOUR = 0.1;
const MOST_DIMMING = 0.4;
/** View height (CSS px) the colour intensities were tuned at: the 3D view at 1920×1080. */
const REFERENCE_VIEW_HEIGHT = 980;

interface PersonLook {
  color: Rgb;
  intensity: number;
}

const LOOKS: Readonly<Record<TrackColorRole, PersonLook>> = {
  person: { color: TRACK_COLORS.person.rgb, intensity: pointIntensityForRole('person') },
  keepClear: { color: TRACK_COLORS.keepClear.rgb, intensity: pointIntensityForRole('keepClear') },
  selected: { color: TRACK_COLORS.selected.rgb, intensity: pointIntensityForRole('selected') },
};

/**
 * Everyone on the platform as ONE THREE.Points.
 *
 * The position and colour buffers are allocated once for MAX_PEOPLE people and rewritten in place
 * every animation frame, so the 60 fps loop allocates nothing and the GPU buffers are never rebuilt.
 */
export class PeopleCloud {
  readonly points: Points<BufferGeometry, PointsMaterial>;

  private readonly templates: HumanTemplate[] = createHumanTemplates(TEMPLATE_SEED);
  private readonly positions = new Float32Array(MAX_PEOPLE * HUMAN_POINT_COUNT * 3);
  private readonly colors = new Float32Array(MAX_PEOPLE * HUMAN_POINT_COUNT * 3);
  private readonly positionAttribute = new BufferAttribute(this.positions, 3);
  private readonly colorAttribute = new BufferAttribute(this.colors, 3);

  /** See `setViewHeight`. */
  private viewBrightness = 1;
  /** Brightness multiplier per drawn person this frame, from how crowded they are. */
  private readonly crowdDimming = new Float32Array(MAX_PEOPLE).fill(1);

  /** Where each drawn person is this frame, for picking and the selection ring. */
  private readonly drawnIds: string[] = new Array<string>(MAX_PEOPLE).fill('');
  private readonly drawnX = new Float32Array(MAX_PEOPLE);
  private readonly drawnY = new Float32Array(MAX_PEOPLE);
  private drawnCount = 0;

  constructor() {
    this.positionAttribute.setUsage(DynamicDrawUsage);
    this.colorAttribute.setUsage(DynamicDrawUsage);

    const geometry = new BufferGeometry();
    geometry.setAttribute('position', this.positionAttribute);
    geometry.setAttribute('color', this.colorAttribute);
    geometry.setDrawRange(0, 0);

    const material = new PointsMaterial({
      size: 0.04,
      sizeAttenuation: true,
      vertexColors: true,
      blending: AdditiveBlending,
      transparent: true,
      depthWrite: false,
    });

    this.points = new Points(geometry, material);
    // The buffer contents move every frame, so a bounding sphere computed once would be wrong.
    this.points.frustumCulled = false;
  }

  get count(): number {
    return this.drawnCount;
  }

  idAt(index: number): string {
    return this.drawnIds[index];
  }

  xAt(index: number): number {
    return this.drawnX[index];
  }

  yAt(index: number): number {
    return this.drawnY[index];
  }

  /** Index of a drawn person, or -1. */
  indexOf(trackId: string): number {
    for (let index = 0; index < this.drawnCount; index++) {
      if (this.drawnIds[index] === trackId) {
        return index;
      }
    }
    return -1;
  }

  /**
   * In a smaller view each person covers fewer pixels, so their points overlap more and add up
   * brighter. Dim them in proportion, so people look about the same at 1280×720 as at 1920×1080.
   */
  setViewHeight(viewHeightCss: number): void {
    this.viewBrightness = Math.min(1.1, Math.max(0.7, viewHeightCss / REFERENCE_VIEW_HEIGHT));
  }

  /** Writes everyone into the buffers. `people` comes from the shared TrackMotion, already interpolated. */
  updatePeople(people: readonly DrawablePerson[], keepClearIds: ReadonlySet<string>, selectedId: string | null): void {
    const peopleToDraw = Math.min(people.length, MAX_PEOPLE);
    this.measureCrowding(people, peopleToDraw);

    for (let index = 0; index < peopleToDraw; index++) {
      const person = people[index];
      const template = this.templates[templateIndexForTrackId(person.id, this.templates.length)];
      const role = trackColorRole(person.id, keepClearIds, selectedId);
      const dimming = role === 'selected' ? 1 : this.crowdDimming[index];
      // Scaling the colour fades the person in and out, since black adds nothing.
      this.writePerson(index, template, person, LOOKS[role], dimming * person.opacity * this.viewBrightness);

      this.drawnIds[index] = person.id;
      this.drawnX[index] = person.x;
      this.drawnY[index] = person.y;
    }
    this.drawnCount = peopleToDraw;

    const usedFloats = peopleToDraw * HUMAN_POINT_COUNT * 3;
    this.markUploaded(this.positionAttribute, usedFloats);
    this.markUploaded(this.colorAttribute, usedFloats);
    this.points.geometry.setDrawRange(0, peopleToDraw * HUMAN_POINT_COUNT);
  }

  /** Pairwise, but at most 220 people: about 48 000 cheap checks, well under a millisecond. */
  private measureCrowding(people: readonly DrawablePerson[], count: number): void {
    const radiusSquared = NEIGHBOUR_RADIUS_METRES * NEIGHBOUR_RADIUS_METRES;
    for (let index = 0; index < count; index++) {
      let neighbours = 0;
      for (let other = 0; other < count; other++) {
        const dx = people[other].x - people[index].x;
        const dy = people[other].y - people[index].y;
        if (other !== index && dx * dx + dy * dy < radiusSquared) {
          neighbours++;
        }
      }
      this.crowdDimming[index] = Math.max(MOST_DIMMING, 1 - DIMMING_PER_NEIGHBOUR * neighbours);
    }
  }

  /** Rotates the template by the heading, moves it to the pose, and writes it into slot `slot`. */
  private writePerson(slot: number, template: HumanTemplate, pose: DrawablePerson, look: PersonLook, dimming: number): void {
    const cos = Math.cos(pose.heading);
    const sin = Math.sin(pose.heading);
    const firstFloat = slot * HUMAN_POINT_COUNT * 3;
    const intensity = look.intensity * dimming;

    for (let point = 0; point < HUMAN_POINT_COUNT; point++) {
      const templateOffset = point * 3;
      const forward = template.positions[templateOffset];
      const left = template.positions[templateOffset + 1];
      const up = template.positions[templateOffset + 2];
      const brightness = (0.6 + 0.4 * template.brightness[point]) * intensity;

      const offset = firstFloat + templateOffset;
      this.positions[offset] = pose.x + forward * cos - left * sin;
      this.positions[offset + 1] = pose.y + forward * sin + left * cos;
      this.positions[offset + 2] = up;
      this.colors[offset] = look.color.r * brightness;
      this.colors[offset + 1] = look.color.g * brightness;
      this.colors[offset + 2] = look.color.b * brightness;
    }
  }

  /** Uploads only the part of the buffer in use this frame. */
  private markUploaded(attribute: BufferAttribute, usedFloats: number): void {
    attribute.clearUpdateRanges();
    attribute.addUpdateRange(0, usedFloats);
    attribute.needsUpdate = true;
  }
}
