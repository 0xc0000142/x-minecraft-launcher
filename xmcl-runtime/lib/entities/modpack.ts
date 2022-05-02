import { getAddonFileInfo, getAddonFiles } from '@xmcl/curseforge'
import { createDefaultCurseforgeQuery, DownloadBaseOptions, DownloadTask, UnzipTask } from '@xmcl/installer'
import { joinUrl } from '@xmcl/installer/http/utils'
import { CurseforgeModpackManifest, EditInstanceOptions, McbbsModpackManifest, ModpackFileInfoAddon, ModpackFileInfoCurseforge, ModrinthModpackManifest } from '@xmcl/runtime-api'
import { CancelledError, task } from '@xmcl/task'
import { readEntry } from '@xmcl/unzip'
import { ensureDir } from 'fs-extra'
import { Agent } from 'https'
import { basename, join } from 'path'
import { URL } from 'url'
import { Entry, ZipFile } from 'yauzl'

/**
 * Read the metadata of the modpack
 * @param zip The modpack zip
 * @returns The curseforge or mcbbs manifest
 */
export async function readMetadata(zip: ZipFile, entries: Entry[]) {
  const mcbbsManifest = entries.find(e => e.fileName === 'mcbbs.packmeta')
  if (mcbbsManifest) {
    return readEntry(zip, mcbbsManifest).then(b => JSON.parse(b.toString()) as McbbsModpackManifest)
  }
  const curseforgeManifest = entries.find(e => e.fileName === 'manifest.json')
  if (curseforgeManifest) {
    return readEntry(zip, curseforgeManifest).then(b => JSON.parse(b.toString()) as CurseforgeModpackManifest)
  }
  throw new Error()
}

export function resolveInstanceOptions(manifest: McbbsModpackManifest | CurseforgeModpackManifest | ModrinthModpackManifest): EditInstanceOptions {
  const options: EditInstanceOptions = {
    author: manifest.author,
    version: manifest.version,
    name: manifest.name,
  }
  if ('addons' in manifest) {
    options.description = manifest.description
    options.url = manifest.url
    options.runtime = {
      minecraft: manifest.addons.find(a => a.id === 'game')?.version ?? '',
      forge: manifest.addons.find(a => a.id === 'forge')?.version ?? '',
      liteloader: '',
      fabricLoader: manifest.addons.find(a => a.id === 'fabric')?.version ?? '',
      yarn: '',
    }
    if (manifest.launchInfo) {
      if (manifest.launchInfo.launchArgument) {
        options.mcOptions = manifest.launchInfo.launchArgument
      }
      if (manifest.launchInfo.javaArgument) {
        options.vmOptions = manifest.launchInfo.javaArgument
      }
      if (manifest.launchInfo.minMemory) {
        options.minMemory = Number(manifest.launchInfo.minMemory)
      }
      // if (manifest.launchInfo.supportJava) {
      // options.java
      // }
    }
  } else {
    const forgeId = manifest.minecraft.modLoaders.find(l => l.id.startsWith('forge'))
    const fabricId = manifest.minecraft.modLoaders.find(l => l.id.startsWith('fabric'))
    options.runtime = {
      minecraft: manifest.minecraft.version,
      forge: forgeId ? forgeId.id.substring(6) : '',
      liteloader: '',
      fabricLoader: fabricId ? fabricId.id.substring(7) : '',
      yarn: '',
    }
  }
  return options
}

export class ModpackInstallGeneralError extends Error {
  constructor(readonly files: {
    path: string
    url: string
    projectId: number
    fileId: number
  }[], e: Error) { super(`Fail to install modpack: ${e.message}`) }
}

export class ModpackInstallUrlError extends Error {
  constructor(readonly file: ModpackFileInfoCurseforge) {
    super(`Fail to get curseforge download url project=${file.projectID} file=${file.fileID}`)
    this.name = 'ModpackInstallUrlError'
  }
}

export function installModpackTask(zip: ZipFile, entries: Entry[], manifest: CurseforgeModpackManifest | McbbsModpackManifest | ModrinthModpackManifest, root: string, allowFileApi: boolean, options: DownloadBaseOptions & { agents: { https: Agent } }) {
  return task('installModpack', async function () {
    const files: Array<{ path: string; url: string; projectId: number; fileId: number }> = []
    const ensureDownloadUrl = async (f: ModpackFileInfoCurseforge) => {
      // for (let i = 0; i < 3; ++i) {
      if (this.isCancelled) {
        throw new CancelledError()
      }
      const result = await getAddonFileInfo(f.projectID, f.fileID, { userAgent: options.agents.https })
      return result.downloadUrl
    }
    if (manifest.files) {
      const curseforgeFilesQueue = manifest.files.map(f => f).filter((f): f is ModpackFileInfoCurseforge => !('type' in f) || f.type === 'curse')
      const staging = join(root, 'mods')
      await ensureDir(staging)
      const infos = [] as (ModpackFileInfoCurseforge & { url: string })[]

      let batchCount = 8
      while (curseforgeFilesQueue.length > 0) {
        const batch = curseforgeFilesQueue.splice(0, batchCount)
        const result = await Promise.all(batch.map(async (f) => ensureDownloadUrl(f)))
        let failed = false
        for (let i = 0; i < result.length; i++) {
          const url = result[i]
          if (!url) {
            failed = true
            curseforgeFilesQueue.push(batch[i])
          } else {
            infos.push({ ...batch[i], url })
          }
        }
        if (failed && batchCount > 2) {
          batchCount /= 2
        }
        if (!failed && batchCount < 16) {
          batchCount *= 2
        }
      }

      // download curseforge files
      const tasks = infos.map((f) => {
        const url = f.url
        const destination = join(staging, basename(url))
        return new DownloadTask({
          url,
          destination,
          agents: options.agents,
          segmentPolicy: options.segmentPolicy,
          retryHandler: options.retryHandler,
        }).setName('download').map(() => {
          // side-effect: adding to file list
          files.push({ path: destination, url, projectId: f.projectID, fileId: f.fileID })
          return undefined
        })
      })

      try {
        await this.all(tasks, {
          throwErrorImmediately: false,
          getErrorMessage: (errs) => `Fail to install modpack to ${root}: ${errs.map((e) => e.toString()).join('\n')}`,
        })
      } catch (e) {
        throw new ModpackInstallGeneralError(files, e as Error)
      }
    }

    try {
      await this.yield(new UnzipTask(
        zip,
        entries.filter((e) => !e.fileName.endsWith('/') && e.fileName.startsWith('overrides' in manifest ? manifest.overrides : 'overrides')),
        root,
        (e) => e.fileName.substring('overrides' in manifest ? manifest.overrides.length : 'overrides'.length),
      ).setName('unpack'))

      // download custom files
      if ('fileApi' in manifest && manifest.files && manifest.fileApi && allowFileApi) {
        const fileApi = manifest.fileApi
        const addonFiles = manifest.files.filter((f): f is ModpackFileInfoAddon => f.type === 'addon')
        await this.all(addonFiles.map((f) => new DownloadTask({
          url: joinUrl(fileApi, f.path),
          destination: join(root, f.path),
          validator: {
            algorithm: 'sha1',
            hash: f.hash,
          },
          agents: options.agents,
          segmentPolicy: options.segmentPolicy,
          retryHandler: options.retryHandler,
        }).setName('download')))
      }
    } catch (e) {
      throw new ModpackInstallGeneralError(files, e as Error)
    }

    return files
  })
}
